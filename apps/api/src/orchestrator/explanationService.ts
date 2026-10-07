import { createHash } from 'node:crypto';
import type { AnalysisResult, Explanation } from '@fpc/shared';
import { config } from '../config.js';
import { explain, templateExplanation } from '../explain/explain.js';
import { factGuard } from '../explain/factGuard.js';
import { EXPLAIN_PROMPT_VERSION, buildExplainUserMessage } from '../explain/prompt.js';
import { renderParagraphs } from '../explain/render.js';
import type { Cache } from '../lib/cache.js';
import type { Metrics } from '../lib/metrics.js';
import { fallbackReasonForKind } from '../llm/LlmClient.js';
import type { ManagedLlmClient } from '../llm/managedLlmClient.js';

/** What the answer cache stores: the guard-approved placeholder text, not rendered values. */
export type CachedExplanation = { paragraphs: string[] };

export type ExplainLog = {
  source?: Explanation['source'];
  cache?: 'hit' | 'miss' | 'skip';
  fallbackReason?: string | undefined;
  pending?: boolean;
  attempts?: {
    latencyMs?: number | undefined;
    tokensIn?: number | undefined;
    tokensOut?: number | undefined;
    error?: string | undefined;
    violations: string[];
  }[];
};

/**
 * answer:{sha256(model input)}:{model}:{PROMPT_VERSION}
 *
 * Keyed on exactly what the model receives (verdict, confidence, scope, basis,
 * fact ids + descriptions) — never on values, because the model never sees
 * values. Two queries that differ only in numbers (asking price ±1 ₪) share an
 * entry, so the cache can't be bypassed to force paid calls, and each user's own
 * numbers are still rendered by code. Any data change that alters the analysis
 * alters this input, so DATA_VERSION is implied rather than needed.
 */
export function answerCacheKey(analysis: AnalysisResult, model: string): string {
  const input = buildExplainUserMessage(analysis);
  return `answer:${createHash('sha256').update(input).digest('hex')}:${model}:${EXPLAIN_PROMPT_VERSION}`;
}

/** One place for the explanation's cache / INSUFFICIENT / template rules, used by both routes. */
export class ExplanationService {
  constructor(
    private readonly deps: {
      llm: ManagedLlmClient;
      cache: Cache<CachedExplanation>;
      metrics: Metrics;
      now: () => number;
    },
  ) {}

  /** INSUFFICIENT shortcut or a cache hit, re-checked and rendered with this analysis' numbers. */
  private async fromCache(a: AnalysisResult): Promise<{ explanation: Explanation; log: ExplainLog } | null> {
    if (a.confidence === 'INSUFFICIENT') {
      this.deps.metrics.explainResult('template', { cache: 'skip', fallbackReason: 'insufficient_data' });
      return {
        explanation: templateExplanation(a, 'insufficient_data'),
        log: { source: 'template', cache: 'skip', fallbackReason: 'insufficient_data' },
      };
    }
    const cached = await this.deps.cache.get(answerCacheKey(a, this.deps.llm.model));
    // The guard only depends on fact ids + verdict, which are part of the key, so a hit always
    // passes — re-checking is cheap insurance against a key bug serving the wrong text.
    if (cached && factGuard(cached.paragraphs, { facts: a.facts, verdict: a.verdict?.verdict ?? null }).ok) {
      this.deps.metrics.explainResult('llm', { cache: 'hit' });
      return {
        explanation: { source: 'llm', paragraphs: renderParagraphs(cached.paragraphs, a.facts) },
        log: { source: 'llm', cache: 'hit' },
      };
    }
    return null;
  }

  /**
   * For /api/analyze: an explanation available without waiting on the LLM, or
   * null → the client should call /api/explain.
   */
  async immediate(a: AnalysisResult): Promise<{ explanation: Explanation | null; log: ExplainLog }> {
    const hit = await this.fromCache(a);
    if (hit) return hit;
    const blocked = this.deps.llm.blockedReason();
    if (blocked) {
      const reason = fallbackReasonForKind(blocked);
      this.deps.metrics.explainResult('template', { cache: 'miss', fallbackReason: reason });
      return {
        explanation: templateExplanation(a, reason),
        log: { source: 'template', cache: 'miss', fallbackReason: reason },
      };
    }
    return { explanation: null, log: { pending: true, cache: 'miss' } };
  }

  /** For /api/explain: always returns an explanation (LLM, cached, or template). */
  async generate(
    a: AnalysisResult,
    opts: { deadline: number; signal?: AbortSignal },
  ): Promise<{ explanation: Explanation; log: ExplainLog }> {
    const hit = await this.fromCache(a);
    if (hit) return hit;

    const { explanation, telemetry, llmParagraphs } = await explain(a, {
      llm: this.deps.llm,
      deadline: opts.deadline,
      now: this.deps.now,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    // Only LLM text is cached: templates are free to rebuild, and caching one would keep
    // serving it after the LLM recovers.
    if (llmParagraphs) {
      await this.deps.cache.set(
        answerCacheKey(a, this.deps.llm.model),
        { paragraphs: llmParagraphs },
        config.cache.answerTtlMs,
      );
    }
    const violations = telemetry.attempts.flatMap((x) => x.violations.map((v) => v.rule));
    this.deps.metrics.explainResult(explanation.source, {
      cache: 'miss',
      violations,
      ...(explanation.fallbackReason ? { fallbackReason: explanation.fallbackReason } : {}),
    });
    return {
      explanation,
      log: {
        source: explanation.source,
        cache: 'miss',
        fallbackReason: explanation.fallbackReason,
        attempts: telemetry.attempts.map((x) => ({
          latencyMs: x.latencyMs,
          tokensIn: x.usage?.inputTokens,
          tokensOut: x.usage?.outputTokens,
          error: x.error,
          violations: x.violations.map((v) => v.rule),
        })),
      },
    };
  }
}
