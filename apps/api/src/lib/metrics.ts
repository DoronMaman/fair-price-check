import { config } from '../config.js';
import type { LlmErrorKind, LlmUsage } from '../llm/LlmClient.js';
import { quantile, sortedAsc } from './stats.js';

type Counter = Record<string, number>;
export type CacheOutcome = 'hit' | 'miss' | 'skip';
const inc = (c: Counter, k: string, by = 1) => {
  c[k] = (c[k] ?? 0) + by;
};
const rate = (part: number, total: number) => (total === 0 ? null : Math.round((part / total) * 1000) / 1000);

/**
 * In-process counters since boot, plus "today" counters for LLM spend that reset
 * with the Israel date. Single instance; with several instances these would move
 * to the shared store (Redis) or a metrics backend.
 */
export class Metrics {
  private requests: Counter = {};
  private intent = { llm: 0, fallback: 0, cacheHit: 0, cacheMiss: 0, fallbackReasons: {} as Counter };
  private explain = {
    llm: 0,
    template: 0,
    cacheHit: 0,
    cacheMiss: 0,
    fallbackReasons: {} as Counter,
    guardViolations: {} as Counter,
  };
  private latencies: number[] = [];
  private today: { day: string; calls: number; errors: Counter; inputTokens: number; outputTokens: number };

  constructor(private readonly todayFn: () => string) {
    this.today = this.freshDay();
  }

  private freshDay() {
    return { day: this.todayFn(), calls: 0, errors: {}, inputTokens: 0, outputTokens: 0 };
  }

  private roll() {
    if (this.todayFn() !== this.today.day) this.today = this.freshDay();
  }

  request(route: string) {
    inc(this.requests, route);
  }

  /** cache: 'skip' when the cache wasn't consulted (e.g. LLM off), so it doesn't skew the hit rate. */
  intentResult(source: 'llm' | 'fallback', opts: { cache: CacheOutcome; fallbackReason?: string }) {
    this.intent[source]++;
    if (opts.cache === 'hit') this.intent.cacheHit++;
    if (opts.cache === 'miss') this.intent.cacheMiss++;
    if (opts.fallbackReason) inc(this.intent.fallbackReasons, opts.fallbackReason);
  }

  explainResult(
    source: 'llm' | 'template',
    opts: { cache: CacheOutcome; fallbackReason?: string; violations?: string[] },
  ) {
    this.explain[source]++;
    if (opts.cache === 'hit') this.explain.cacheHit++;
    if (opts.cache === 'miss') this.explain.cacheMiss++;
    if (opts.fallbackReason) inc(this.explain.fallbackReasons, opts.fallbackReason);
    for (const v of opts.violations ?? []) inc(this.explain.guardViolations, v);
  }

  /** Every call that actually went to the provider (billed or failed). */
  llmCall(opts: { usage?: LlmUsage; latencyMs?: number; error?: LlmErrorKind }) {
    this.roll();
    this.today.calls++;
    if (opts.error) inc(this.today.errors, opts.error);
    if (opts.usage) {
      this.today.inputTokens += opts.usage.inputTokens;
      this.today.outputTokens += opts.usage.outputTokens;
    }
    if (opts.latencyMs !== undefined) {
      this.latencies.push(opts.latencyMs);
      if (this.latencies.length > config.metrics.latencyWindow) this.latencies.shift();
    }
  }

  snapshot() {
    this.roll();
    const p = config.pricing;
    const spend =
      (this.today.inputTokens * p.inputUsdPerMTok + this.today.outputTokens * p.outputUsdPerMTok) / 1_000_000;
    const lat = sortedAsc(this.latencies);
    const intentTotal = this.intent.llm + this.intent.fallback;
    const explainTotal = this.explain.llm + this.explain.template;
    return {
      requests: this.requests,
      intent: {
        ...this.intent,
        fallbackRate: rate(this.intent.fallback, intentTotal),
        cacheHitRate: rate(this.intent.cacheHit, this.intent.cacheHit + this.intent.cacheMiss),
      },
      explain: {
        ...this.explain,
        fallbackRate: rate(this.explain.template, explainTotal),
        cacheHitRate: rate(this.explain.cacheHit, this.explain.cacheHit + this.explain.cacheMiss),
      },
      llmToday: {
        ...this.today,
        latencyMs: lat.length ? { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95) } : null,
        estimatedSpendUsd: Math.round(spend * 10_000) / 10_000,
        pricing: { ...p, source: 'platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-06)' },
      },
    };
  }
}
