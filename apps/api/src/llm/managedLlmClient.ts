import { config } from '../config.js';
import type { CircuitBreaker } from '../lib/circuitBreaker.js';
import type { DailyBudget } from '../lib/dailyBudget.js';
import type { Metrics } from '../lib/metrics.js';
import {
  LlmError,
  unconfiguredLlmClient,
  type LlmClient,
  type LlmErrorKind,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from './LlmClient.js';

/** Failures that say the provider (or our access to it) is unhealthy — vs. a bad answer from a healthy one. */
const INFRA_FAILURES: ReadonlySet<LlmErrorKind> = new Set([
  'timeout',
  'unavailable',
  'rate_limited',
  'request_rejected',
]);

export type BlockedReason = Extract<
  LlmErrorKind,
  'not_configured' | 'auth_failed' | 'circuit_open' | 'budget_exhausted'
>;

/** Called for every failed provider call; the server wires this to its logger. */
export type LlmErrorListener = (kind: LlmErrorKind, message: string) => void;

/**
 * The single gate every LLM call goes through: circuit breaker, global daily
 * call budget, auth-failure latch, and per-call metrics (tokens, latency,
 * errors → spend estimate). Blocked calls throw an LlmError before any network
 * I/O, so callers take their deterministic fallback path — never an error to the user.
 */
export class ManagedLlmClient implements LlmClient {
  /** Set when the provider rejects our key; calls stop until the cooldown passes. */
  private authFailedAt: number | null = null;
  private onError: LlmErrorListener = () => {};

  constructor(
    private readonly inner: LlmClient,
    private readonly deps: { breaker: CircuitBreaker; budget: DailyBudget; metrics: Metrics; now: () => number },
  ) {}

  get model(): string {
    return this.inner.model;
  }

  /** A key was provided. (It may still be invalid — see blockedReason().) */
  get configured(): boolean {
    return this.inner !== unconfiguredLlmClient;
  }

  setErrorListener(listener: LlmErrorListener): void {
    this.onError = listener;
  }

  private authLatched(): boolean {
    if (this.authFailedAt === null) return false;
    if (this.deps.now() - this.authFailedAt >= config.resilience.authFailureCooldownMs) {
      this.authFailedAt = null; // let one call through to see if the key was fixed
      return false;
    }
    return true;
  }

  /** Why a call would be refused right now (without reserving anything), or null. */
  blockedReason(): BlockedReason | null {
    if (!this.configured) return 'not_configured';
    if (this.authLatched()) return 'auth_failed';
    if (!this.deps.budget.hasRemaining()) return 'budget_exhausted';
    if (this.deps.breaker.state() === 'open') return 'circuit_open';
    return null;
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    const notSent = (kind: LlmErrorKind, msg: string) => new LlmError(kind, msg, { sent: false });
    if (!this.configured) throw notSent('not_configured', 'LLM_API_KEY is not set');
    if (this.authLatched()) throw notSent('auth_failed', 'LLM key rejected recently; not retrying yet');
    // Check budget → reserve breaker slot → consume budget. Consuming first would waste a
    // unit when the breaker refuses; acquiring first would strand a half-open trial slot
    // when the budget is empty. (Single-threaded, so check-then-consume can't race.)
    if (!this.deps.budget.hasRemaining()) throw notSent('budget_exhausted', 'daily LLM call budget used up');
    if (!this.deps.breaker.tryAcquire()) throw notSent('circuit_open', 'LLM circuit open');
    this.deps.budget.tryConsume();

    try {
      const res = await this.inner.generateJson(req);
      this.deps.breaker.recordSuccess();
      this.deps.metrics.llmCall({ usage: res.usage, latencyMs: res.latencyMs });
      return res;
    } catch (err) {
      const error = err instanceof LlmError ? err : new LlmError('unavailable', String(err));
      // Client disconnected: says nothing about provider health, and nobody needs logging about it.
      if (error.kind === 'aborted') {
        this.deps.breaker.release();
        this.deps.metrics.llmCall({ error: 'aborted' });
        throw error;
      }
      if (error.kind === 'auth_failed') this.authFailedAt = this.deps.now();
      // A refusal or schema miss means the provider is up; only infra failures trip the breaker.
      if (INFRA_FAILURES.has(error.kind)) this.deps.breaker.recordFailure();
      else this.deps.breaker.recordSuccess();
      this.deps.metrics.llmCall({ error: error.kind, ...(error.usage ? { usage: error.usage } : {}) });
      this.onError(error.kind, error.message);
      throw error;
    }
  }
}
