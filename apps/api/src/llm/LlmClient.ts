import type { z } from 'zod';
import type { FallbackReason } from '@fpc/shared';

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmJsonRequest<T> = {
  /** Short name for logs/metrics, e.g. "intent" or "explain". */
  purpose: string;
  system: string;
  user: string;
  /** Output is constrained to this schema (structured output) and parsed with it. */
  schema: z.ZodType<T>;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type LlmJsonResponse<T> = {
  data: T;
  usage: LlmUsage;
  latencyMs: number;
  model: string;
};

export type LlmErrorKind =
  | 'not_configured'
  /** 401/403: the key is invalid, revoked or lacks permission. Not "off by design". */
  | 'auth_failed'
  /** Other 4xx the provider rejected (malformed request, billing/credit problems). */
  | 'request_rejected'
  | 'timeout'
  /** The client went away; we cancelled the call. Not a provider problem. */
  | 'aborted'
  | 'rate_limited'
  | 'unavailable'
  | 'refusal'
  | 'invalid_output'
  /** Raised before any network call by ManagedLlmClient. */
  | 'circuit_open'
  | 'budget_exhausted';

const FALLBACK_FOR: Record<LlmErrorKind, FallbackReason> = {
  not_configured: 'llm_not_configured',
  auth_failed: 'llm_auth_failed',
  request_rejected: 'unavailable',
  timeout: 'timeout',
  aborted: 'timeout',
  rate_limited: 'rate_limited',
  unavailable: 'unavailable',
  refusal: 'refusal',
  invalid_output: 'invalid_output',
  circuit_open: 'circuit_open',
  budget_exhausted: 'budget_exhausted',
};

export const fallbackReasonForKind = (kind: LlmErrorKind): FallbackReason => FALLBACK_FOR[kind];

/** How an LLM failure is reported to the user/metrics. Non-LlmErrors count as "unavailable". */
export function fallbackReasonFor(err: unknown): FallbackReason {
  return FALLBACK_FOR[err instanceof LlmError ? err.kind : 'unavailable'];
}

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    opts: {
      /** Tokens were still billed for refusals / invalid output; keep them for cost metrics. */
      usage?: LlmUsage | undefined;
      /** False when the error was raised before any request reached the provider. */
      sent?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.usage = opts.usage;
    this.sent = opts.sent ?? true;
  }

  readonly usage: LlmUsage | undefined;
  readonly sent: boolean;
}

/** Provider-neutral boundary. Swapping models or vendors means a new implementation of this. */
export interface LlmClient {
  readonly model: string;
  generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>>;
}

/** Used when no API key is configured: every call fails fast, so callers take their fallback path. */
export const unconfiguredLlmClient: LlmClient = {
  model: 'none',
  async generateJson() {
    throw new LlmError('not_configured', 'LLM_API_KEY is not set', { sent: false });
  },
};
