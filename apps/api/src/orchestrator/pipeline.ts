import { createHash } from 'node:crypto';
import {
  PropertyQuerySchema,
  QUERY_FIELDS,
  normalizeInputText,
  type AnalysisResult,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type DroppedField,
  type ExplainRequest,
  type ExplainResponse,
  type IntentResult,
  type PropertyQueryDraft,
} from '@fpc/shared';
import { analyze } from '../analytics/analyze.js';
import { config } from '../config.js';
import { parseIntent } from '../intent/parseIntent.js';
import { validateIntent } from '../intent/validateIntent.js';
import type { AppContext } from './context.js';
import type { ExplainLog } from './explanationService.js';

/** Structured per-request log line. Typed so dashboards don't silently lose fields. */
export type RequestLog = {
  input?: { kind: 'text'; chars: number; hash: string } | { kind: 'query' };
  intent?: {
    source: IntentResult['source'];
    cache: 'hit' | 'miss' | 'skip';
    fallbackReason?: string | undefined;
    llmLatencyMs?: number | undefined;
    tokensIn?: number | undefined;
    tokensOut?: number | undefined;
    error?: string | undefined;
  };
  dropped?: string[];
  analysis?: AnalysisLog;
  explain?: ExplainLog;
  totalMs?: number;
};

type AnalysisLog = { scope: string; confidence: string; nComps: number; verdict?: string | undefined };

export type RequestOpts = { signal?: AbortSignal };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Sorted keys, every query field present (missing → null), so equal queries serialize equally. */
export function canonicalQueryJson(q: PropertyQueryDraft): string {
  const obj: Record<string, unknown> = {};
  for (const f of [...QUERY_FIELDS].sort()) obj[f] = q[f] ?? null;
  return JSON.stringify(obj);
}

function runAnalysis(draft: PropertyQueryDraft, ctx: AppContext): AnalysisResult | null {
  if (!draft.city) return null;
  // validateIntent already guaranteed every field; this parse is the type-level proof.
  return analyze(PropertyQuerySchema.parse(draft), ctx.dataset, { today: ctx.today() });
}

const analysisLog = (a: AnalysisResult): AnalysisLog => ({
  scope: a.scope,
  confidence: a.confidence,
  nComps: a.nComps,
  verdict: a.verdict?.verdict,
});

/**
 * POST /api/analyze: normalize → intent (cache → LLM → fallback) → validate →
 * analytics → explanation only if available without waiting. Never waits on the
 * explanation LLM call; that's /api/explain.
 */
export async function handleAnalyze(
  req: AnalyzeRequest,
  ctx: AppContext,
  opts: RequestOpts = {},
): Promise<{ response: AnalyzeResponse; log: RequestLog }> {
  const started = ctx.now();
  const deadline = started + config.resilience.requestBudgetMs;
  const log: RequestLog = {};

  let intent: IntentResult | null = null;
  let draft: PropertyQueryDraft;
  let dropped: DroppedField[];

  if ('text' in req) {
    const text = normalizeInputText(req.text);
    // The text itself is never logged: a hash is enough to correlate repeats.
    log.input = { kind: 'text', chars: text.length, hash: sha256(text).slice(0, 12) };
    const { result, telemetry } = await parseIntent(text, {
      llm: ctx.llm,
      knownNeighborhoods: ctx.knownNeighborhoods,
      cache: ctx.intentCache,
      timeoutMs: Math.max(1, Math.min(config.llm.intentTimeoutMs, deadline - ctx.now())),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    intent = result;
    ({ draft, dropped } = result);
    ctx.metrics.intentResult(result.source, {
      cache: telemetry.cache,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    });
    log.intent = {
      source: result.source,
      cache: telemetry.cache,
      fallbackReason: result.fallbackReason,
      llmLatencyMs: telemetry.latencyMs,
      tokensIn: telemetry.usage?.inputTokens,
      tokensOut: telemetry.usage?.outputTokens,
      error: telemetry.error,
    };
  } else {
    log.input = { kind: 'query' };
    ({ draft, dropped } = validateIntent(req.query, { knownNeighborhoods: ctx.knownNeighborhoods }));
  }
  if (dropped.length) log.dropped = dropped.map((d) => `${d.field}:${d.reason}`);

  const analysis = runAnalysis(draft, ctx);
  let explanation = null;
  if (analysis) {
    log.analysis = analysisLog(analysis);
    const resolved = await ctx.explanations.immediate(analysis);
    explanation = resolved.explanation;
    log.explain = resolved.log;
  }

  log.totalMs = ctx.now() - started;
  return {
    response: {
      dataVersion: ctx.dataset.dataVersion,
      intent,
      draft,
      dropped,
      analysis,
      explanation,
      explanationPending: analysis !== null && explanation === null,
    },
    log,
  };
}

/**
 * POST /api/explain: recomputes the analysis from the query (never trusts a
 * client-sent analysis), then cache → LLM → fact guard → template. Always answers.
 */
export async function handleExplain(
  req: ExplainRequest,
  ctx: AppContext,
  opts: RequestOpts = {},
): Promise<{ response: ExplainResponse; log: RequestLog }> {
  const started = ctx.now();
  const log: RequestLog = {};

  const { draft, dropped } = validateIntent(req.query, { knownNeighborhoods: ctx.knownNeighborhoods });
  if (dropped.length) log.dropped = dropped.map((d) => `${d.field}:${d.reason}`);
  // City is required by ExplainRequestSchema and is a canonical enum value, so validation keeps it.
  const analysis = runAnalysis(draft, ctx);
  if (!analysis) throw new Error('explain: validated query has no city');
  log.analysis = analysisLog(analysis);

  const { explanation, log: explainLog } = await ctx.explanations.generate(analysis, {
    deadline: started + config.resilience.requestBudgetMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  log.explain = explainLog;
  log.totalMs = ctx.now() - started;
  return { response: { dataVersion: ctx.dataset.dataVersion, explanation }, log };
}
