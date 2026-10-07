import type { AnalysisResult, Explanation, ExplanationFallbackReason, FallbackReason } from '@fpc/shared';
import { config } from '../config.js';
import { LlmError, fallbackReasonFor, type LlmClient, type LlmErrorKind, type LlmUsage } from '../llm/LlmClient.js';
import { factGuard, type Violation } from './factGuard.js';
import {
  EXPLAIN_SYSTEM_PROMPT,
  ExplanationLlmOutputSchema,
  buildExplainUserMessage,
  buildRetryUserMessage,
  type ExplanationLlmOutput,
} from './prompt.js';
import { renderParagraphs } from './render.js';
import { buildTemplateParagraphs } from './template.js';

export type ExplainAttempt = { usage?: LlmUsage; latencyMs?: number; violations: Violation[]; error?: LlmErrorKind };
export type ExplainTelemetry = { attempts: ExplainAttempt[] };

export type ExplainDeps = {
  llm: LlmClient;
  /** Set by the orchestrator (circuit open / budget exhausted). */
  skipLlm?: FallbackReason;
  /** Absolute time (ms since epoch) by which we must have an answer. */
  deadline?: number;
  now?: () => number;
  /** Aborted when the HTTP client disconnects. */
  signal?: AbortSignal;
};

export type ExplainOutcome = {
  explanation: Explanation;
  telemetry: ExplainTelemetry;
  /** The guard-approved placeholder text, when the LLM produced it — this is what gets cached. */
  llmParagraphs?: string[];
};

export function templateExplanation(a: AnalysisResult, reason: ExplanationFallbackReason): Explanation {
  return {
    source: 'template',
    paragraphs: renderParagraphs(buildTemplateParagraphs(a), a.facts),
    fallbackReason: reason,
  };
}

/**
 * LLM explanation, grounded: the model writes placeholders only, factGuard
 * checks the raw text, code renders the values. One retry with the violations
 * fed back; otherwise the template. Never throws.
 */
export async function explain(a: AnalysisResult, deps: ExplainDeps): Promise<ExplainOutcome> {
  const telemetry: ExplainTelemetry = { attempts: [] };
  const done = (reason: ExplanationFallbackReason) => ({ explanation: templateExplanation(a, reason), telemetry });

  // Nothing to explain beyond "too few deals" — not worth a model call.
  if (a.confidence === 'INSUFFICIENT') return done('insufficient_data');
  if (deps.skipLlm) return done(deps.skipLlm);

  const now = deps.now ?? Date.now;
  const verdict = a.verdict?.verdict ?? null;
  let previous: { output: ExplanationLlmOutput; violations: Violation[] } | null = null;

  for (let attempt = 1; attempt <= config.explain.maxAttempts; attempt++) {
    const remaining = deps.deadline === undefined ? Infinity : deps.deadline - now();
    const minNeeded = attempt === 1 ? 1 : config.explain.minMsForRetry;
    if (remaining < minNeeded) return done(attempt === 1 ? 'timeout' : 'guard_failed');

    let output: ExplanationLlmOutput;
    try {
      const res = await deps.llm.generateJson({
        purpose: attempt === 1 ? 'explain' : 'explain_retry',
        system: EXPLAIN_SYSTEM_PROMPT,
        user: previous ? buildRetryUserMessage(a, previous.output, previous.violations) : buildExplainUserMessage(a),
        schema: ExplanationLlmOutputSchema,
        maxTokens: config.llm.explainMaxTokens,
        timeoutMs: Math.min(config.llm.explainTimeoutMs, remaining),
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      output = res.data;
      const guard = factGuard(output.paragraphs, { facts: a.facts, verdict });
      telemetry.attempts.push({ usage: res.usage, latencyMs: res.latencyMs, violations: guard.violations });
      if (guard.ok) {
        return {
          explanation: { source: 'llm', paragraphs: renderParagraphs(output.paragraphs, a.facts) },
          telemetry,
          llmParagraphs: output.paragraphs,
        };
      }
      previous = { output, violations: guard.violations };
    } catch (err) {
      const kind: LlmErrorKind = err instanceof LlmError ? err.kind : 'unavailable';
      telemetry.attempts.push({
        violations: [],
        error: kind,
        ...(err instanceof LlmError && err.usage ? { usage: err.usage } : {}),
      });
      return done(fallbackReasonFor(err));
    }
  }
  return done('guard_failed');
}
