import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LlmError, type LlmClient, type LlmJsonRequest, type LlmJsonResponse } from './LlmClient.js';

/**
 * Claude via the official SDK, using structured outputs (output_config.format),
 * so the response is constrained to the schema at decode time and then
 * re-validated here with the same zod schema.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    /** Tests inject a fake fetch to replay recorded HTTP responses through the real SDK. */
    opts: { fetch?: typeof fetch } = {},
  ) {
    // No SDK-level retries: each call has a tight latency budget, and the
    // orchestrator (circuit breaker + deterministic fallback) owns failure handling.
    this.client = new Anthropic({ apiKey, maxRetries: 0, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    const started = performance.now();
    let response;
    try {
      // create() rather than parse(): parse() throws on non-JSON text *before* we can see
      // stop_reason, which turned refusals into "invalid output" and lost their billed usage.
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          // Extraction and rule-following, not creativity: keep sampling deterministic.
          temperature: 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: zodOutputFormat(req.schema) },
        },
        { timeout: req.timeoutMs, ...(req.signal ? { signal: req.signal } : {}) },
      );
    } catch (err) {
      throw toLlmError(err);
    }

    const latencyMs = Math.round(performance.now() - started);
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

    if (response.stop_reason === 'refusal') throw new LlmError('refusal', 'model refused', { usage });
    if (response.stop_reason === 'max_tokens') {
      throw new LlmError('invalid_output', 'output truncated at max_tokens', { usage });
    }
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError('invalid_output', 'output is not JSON', { usage });
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success)
      throw new LlmError('invalid_output', `output did not match schema: ${parsed.error.message}`, { usage });

    return { data: parsed.data, usage, latencyMs, model: response.model };
  }
}

/** Exported for tests: maps SDK errors to our provider-neutral kinds. */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('timeout', err.message);
  // Our own AbortSignal fired: the HTTP client disconnected, so nobody is waiting for the answer.
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', 'cancelled: client disconnected');
  if (err instanceof Anthropic.RateLimitError) return new LlmError('rate_limited', err.message);
  // A bad/revoked key is a broken deployment, not "LLM switched off" — it must be loud.
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('auth_failed', err.message);
  }
  // 400/404/422 etc.: the provider rejected our request (or the account, e.g. credit) —
  // not a bad answer from a healthy model.
  if (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 400 && err.status < 500) {
    return new LlmError('request_rejected', err.message);
  }
  if (err instanceof Anthropic.APIError) return new LlmError('unavailable', err.message);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('unavailable', err.message);
  if (err instanceof Error) return new LlmError('unavailable', err.message);
  return new LlmError('unavailable', String(err));
}
