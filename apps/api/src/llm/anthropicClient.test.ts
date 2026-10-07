import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmClient } from './anthropicClient.js';

// The real client + real SDK, with HTTP replaced by canned responses. This covers
// the error mapping (where the bad-key bug lived) and the structured-output parse.

const REQ = {
  purpose: 'test',
  system: 'sys',
  user: 'u',
  schema: z.object({ city: z.string().nullable() }),
  maxTokens: 50,
  timeoutMs: 2_000,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  });

const apiError = (status: number, type: string, message: string) =>
  json(status, { type: 'error', error: { type, message } });

/** A Messages API success body whose text is the structured JSON output. */
const message = (text: string, stopReason = 'end_turn') =>
  json(200, {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 34 },
  });

const clientReturning = (res: () => Response | Promise<Response>) =>
  new AnthropicLlmClient('sk-ant-test', 'claude-haiku-4-5', { fetch: async () => res() });

describe('AnthropicLlmClient — error mapping', () => {
  it.each([
    [401, 'authentication_error', 'auth_failed'],
    [403, 'permission_error', 'auth_failed'],
    [400, 'invalid_request_error', 'request_rejected'],
    [404, 'not_found_error', 'request_rejected'],
    [429, 'rate_limit_error', 'rate_limited'],
    [500, 'api_error', 'unavailable'],
    [529, 'overloaded_error', 'unavailable'],
  ] as const)('HTTP %d (%s) → %s', async (status, type, kind) => {
    const llm = clientReturning(() => apiError(status, type, 'x'));
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ name: 'LlmError', kind, sent: true });
  });

  it('a network failure → unavailable', async () => {
    const llm = new AnthropicLlmClient('k', 'm', {
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('a slow response → timeout', async () => {
    const llm = new AnthropicLlmClient('k', 'm', {
      fetch: (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    await expect(llm.generateJson({ ...REQ, timeoutMs: 50 })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('AnthropicLlmClient — responses', () => {
  it('parses structured output and reports usage', async () => {
    const res = await clientReturning(() => message('{"city":"חולון"}')).generateJson(REQ);
    expect(res.data).toEqual({ city: 'חולון' });
    expect(res.usage).toEqual({ inputTokens: 812, outputTokens: 34 });
  });

  it('refusal → refusal, with the billed tokens kept', async () => {
    const llm = clientReturning(() => message('', 'refusal'));
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'refusal', usage: { inputTokens: 812 } });
  });

  it('truncated at max_tokens → invalid_output', async () => {
    await expect(clientReturning(() => message('{"city":"חו', 'max_tokens')).generateJson(REQ)).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });

  it('JSON that does not match the schema → invalid_output', async () => {
    await expect(clientReturning(() => message('{"city":42}')).generateJson(REQ)).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });
});

describe('recordingFetch → replay round trip', () => {
  it('a recorded response replays through the real client, and no auth header is stored', async () => {
    const { mkdtempSync, readdirSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { recordingFetch } = await import('./recordingFetch.js');
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));

    const live = new AnthropicLlmClient('sk-ant-SECRET', 'claude-haiku-4-5', {
      fetch: recordingFetch(dir, async () => message('{"city":"חולון"}')),
    });
    await live.generateJson(REQ);

    const [file] = readdirSync(dir);
    const raw = readFileSync(join(dir, file!), 'utf8');
    expect(raw).not.toContain('SECRET');
    const rec = JSON.parse(raw) as { status: number; response: unknown };
    const replay = clientReturning(() => json(rec.status, rec.response));
    await expect(replay.generateJson(REQ)).resolves.toMatchObject({ data: { city: 'חולון' } });
  });
});
