// Explanation eval: real LLM explanations for every eval case that has a city,
// with and without an asking price. Measures the fact-guard pass rate and the
// real token usage per explanation (input for COST.md).
//   LLM_API_KEY=... npm run eval:explain -w @fpc/api
import { PropertyQuerySchema, type PropertyQuery } from '@fpc/shared';
import { analyze } from '../analytics/analyze.js';
import { config } from '../config.js';
import { loadDataset } from '../data/loadDataset.js';
import { explain } from '../explain/explain.js';
import { EXPLAIN_PROMPT_VERSION } from '../explain/prompt.js';
import { toPlainText } from '../explain/render.js';
import { knownNeighborhoodsOf, validateIntent } from '../intent/validateIntent.js';
import { createLlmClient } from '../llm/createLlmClient.js';
import { unconfiguredLlmClient } from '../llm/LlmClient.js';
import { loadIntentCases, saveResult } from './evalCases.js';

const llm = createLlmClient();
if (llm === unconfiguredLlmClient) throw new Error('eval:explain needs LLM_API_KEY (it measures the real model)');

const dataset = loadDataset();
const ctx = { knownNeighborhoods: knownNeighborhoodsOf(dataset.deals) };

// Expected queries from the intent eval, validated like any input, plus a no-asking-price variant.
const queries: { id: string; query: PropertyQuery }[] = [];
for (const c of loadIntentCases()) {
  const { draft } = validateIntent(c.expected, ctx);
  const parsed = PropertyQuerySchema.safeParse(draft);
  if (!parsed.success) continue; // no city → nothing to explain
  queries.push({ id: `${c.id}`, query: parsed.data });
  if (parsed.data.askingPriceNis !== undefined) {
    const { askingPriceNis: _, ...noAsking } = parsed.data;
    queries.push({ id: `${c.id}-no-asking`, query: noAsking });
  }
}

const rows = [];
for (const { id, query } of queries) {
  const analysis = analyze(query, dataset, { today: new Date().toISOString().slice(0, 10) });
  const { explanation, telemetry } = await explain(analysis, {
    llm,
    deadline: Date.now() + config.resilience.requestBudgetMs,
  });
  rows.push({
    id,
    confidence: analysis.confidence,
    verdict: analysis.verdict?.verdict ?? null,
    source: explanation.source,
    fallbackReason: explanation.fallbackReason,
    attempts: telemetry.attempts.map((a) => ({
      inputTokens: a.usage?.inputTokens,
      outputTokens: a.usage?.outputTokens,
      latencyMs: a.latencyMs,
      error: a.error,
      violations: a.violations.map((v) => `${v.rule}: ${v.detail}`),
    })),
    text: toPlainText(explanation.paragraphs),
  });
  process.stdout.write(explanation.source === 'llm' ? (telemetry.attempts.length === 1 ? '.' : 'r') : 't');
}
console.log('\n');

const called = rows.filter((r) => r.attempts.length > 0);
const firstOk = called.filter((r) => r.source === 'llm' && r.attempts.length === 1).length;
const retryOk = called.filter((r) => r.source === 'llm' && r.attempts.length === 2).length;
const template = called.filter((r) => r.source === 'template').length;
const violations: Record<string, number> = {};
for (const r of called)
  for (const a of r.attempts)
    for (const v of a.violations) {
      const rule = v.split(':')[0]!;
      violations[rule] = (violations[rule] ?? 0) + 1;
    }
const pct = (n: number) => `${((100 * n) / Math.max(1, called.length)).toFixed(0)}%`;
console.log(
  `model=${llm.model} prompt=${EXPLAIN_PROMPT_VERSION} explanations=${called.length} (skipped, INSUFFICIENT: ${rows.length - called.length})`,
);
console.log(
  `passed guard on 1st try: ${firstOk} (${pct(firstOk)})  after retry: ${retryOk} (${pct(retryOk)})  → template: ${template} (${pct(template)})`,
);
console.log('violations by rule:', violations);
for (const r of called.filter((x) => x.attempts.some((a) => a.violations.length))) {
  console.log(`  #${r.id}: ${r.attempts.flatMap((a) => a.violations).join(' | ')}`);
}

const file = saveResult('explain-llm', {
  model: llm.model,
  promptVersion: EXPLAIN_PROMPT_VERSION,
  summary: { explanations: called.length, firstOk, retryOk, template, violations },
  rows,
});
console.log(`\nsaved ${file}`);
