import { createHash } from 'node:crypto';
import { normalizeInputText, type FallbackReason, type IntentResult } from '@fpc/shared';
import { config } from '../config.js';
import type { Cache } from '../lib/cache.js';
import { LlmError, fallbackReasonFor, type LlmClient, type LlmErrorKind, type LlmUsage } from '../llm/LlmClient.js';
import { fallbackParse } from './fallbackParser.js';
import {
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_PROMPT,
  IntentLlmOutputSchema,
  buildIntentUserMessage,
  type IntentLlmOutput,
} from './prompt.js';
import { validateIntent, type IntentCandidate, type KnownNeighborhoods } from './validateIntent.js';

/** Telemetry for logs/metrics/cost — not part of the API response. */
export type IntentTelemetry = {
  llmCalled: boolean;
  /** 'skip' when the cache wasn't consulted (LLM skipped, or no cache given). */
  cache: 'hit' | 'miss' | 'skip';
  usage?: LlmUsage;
  latencyMs?: number;
  model?: string;
  error?: LlmErrorKind;
};

const ASK_CITY = 'באיזו עיר נמצא הנכס?';
const unknownCity = (name: string) => `אין לנו עסקאות מ${name}. אפשר לבחור עיר אחרת מהרשימה.`;

/**
 * The model's clarification is user-facing free text, so it's shown only if it
 * is short Hebrew with no digits (no facts or numbers can slip through it).
 */
export function safeClarification(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (t.length === 0 || t.length > config.intent.maxClarificationChars || /\d/.test(t) || !/[\u0590-\u05FF]/.test(t))
    return undefined;
  return t;
}

/** intent:{sha256(normalizedText)}:{PROMPT_VERSION} */
export function intentCacheKey(normalizedText: string): string {
  return `intent:${createHash('sha256').update(normalizedText).digest('hex')}:${INTENT_PROMPT_VERSION}`;
}

export type ParseIntentDeps = {
  llm: LlmClient;
  knownNeighborhoods: KnownNeighborhoods;
  timeoutMs?: number;
  /** Set by the orchestrator to skip the LLM entirely. */
  skipLlm?: FallbackReason;
  /**
   * Caches the RAW model output, not the validated draft: it's re-validated on
   * every read, so a data change (new neighborhoods) or a validation fix applies
   * to cached entries too. Only successful LLM outputs are cached.
   */
  cache?: Cache<IntentLlmOutput>;
  /** Aborted when the HTTP client disconnects. */
  signal?: AbortSignal;
};

/**
 * Text → validated draft query. Tries the cache, then the LLM; on any failure
 * uses the deterministic parser. Both paths go through validateIntent(), so
 * the analytics engine never sees an unvalidated value.
 */
export async function parseIntent(
  rawText: string,
  deps: ParseIntentDeps,
): Promise<{ result: IntentResult; telemetry: IntentTelemetry }> {
  const text = normalizeInputText(rawText);
  const ctx = { knownNeighborhoods: deps.knownNeighborhoods };
  if (deps.skipLlm) return fallback(text, ctx, deps.skipLlm, { llmCalled: false, cache: 'skip' });

  const key = intentCacheKey(text);
  const cached = deps.cache ? await deps.cache.get(key) : undefined;
  if (cached) return fromLlmOutput(cached, ctx, { llmCalled: false, cache: 'hit' });
  const cache = deps.cache ? 'miss' : 'skip';

  try {
    const res = await deps.llm.generateJson({
      purpose: 'intent',
      system: INTENT_SYSTEM_PROMPT,
      user: buildIntentUserMessage(text),
      schema: IntentLlmOutputSchema,
      maxTokens: config.llm.intentMaxTokens,
      timeoutMs: deps.timeoutMs ?? config.llm.intentTimeoutMs,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    await deps.cache?.set(key, res.data, config.cache.intentTtlMs);
    return fromLlmOutput(res.data, ctx, {
      llmCalled: true,
      cache,
      usage: res.usage,
      latencyMs: res.latencyMs,
      model: res.model,
    });
  } catch (err) {
    const kind: LlmErrorKind = err instanceof LlmError ? err.kind : 'unavailable';
    const sent = err instanceof LlmError ? err.sent : true;
    return fallback(text, ctx, fallbackReasonFor(err), {
      llmCalled: sent,
      cache: sent ? cache : 'skip',
      error: kind,
      ...(err instanceof LlmError && err.usage ? { usage: err.usage } : {}),
    });
  }
}

function fromLlmOutput(
  output: IntentLlmOutput,
  ctx: { knownNeighborhoods: KnownNeighborhoods },
  telemetry: IntentTelemetry,
): { result: IntentResult; telemetry: IntentTelemetry } {
  const { unparsed, clarificationNeeded, cityAsWritten, ...fields } = output;
  const { draft, dropped } = validateIntent(fields satisfies IntentCandidate, ctx);

  const writtenCity = draft.city ? undefined : cityAsWritten?.trim() || undefined;
  const clarification = draft.city
    ? safeClarification(clarificationNeeded)
    : writtenCity
      ? unknownCity(writtenCity)
      : (safeClarification(clarificationNeeded) ?? ASK_CITY);

  return {
    result: {
      draft,
      source: 'llm',
      dropped,
      unparsed: unparsed.map((s) => s.trim()).filter(Boolean),
      ...(clarification ? { clarificationNeeded: clarification } : {}),
      ...(writtenCity ? { cityAsWritten: writtenCity } : {}),
    },
    telemetry,
  };
}

function fallback(
  text: string,
  ctx: { knownNeighborhoods: KnownNeighborhoods },
  reason: FallbackReason,
  telemetry: IntentTelemetry,
): { result: IntentResult; telemetry: IntentTelemetry } {
  const { draft, dropped } = validateIntent(fallbackParse(text), ctx);
  return {
    result: {
      draft,
      source: 'fallback',
      fallbackReason: reason,
      dropped,
      unparsed: [],
      ...(draft.city ? {} : { clarificationNeeded: ASK_CITY }),
    },
    telemetry,
  };
}
