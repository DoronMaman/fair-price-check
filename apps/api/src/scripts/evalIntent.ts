// Intent-extraction eval: per-field accuracy over evals/intent.jsonl.
//   npm run eval:intent -w @fpc/api                    # LLM if LLM_API_KEY is set, else fallback
//   npm run eval:intent -w @fpc/api -- --mode=fallback  # regex parser only, free
// In LLM mode this makes 25 real API calls; token counts are saved for COST.md.
import { QUERY_FIELDS, type IntentResult, type QueryField } from '@fpc/shared';
import { config } from '../config.js';
import { env } from '../env.js';
import { loadDataset } from '../data/loadDataset.js';
import { createLlmClient } from '../llm/createLlmClient.js';
import { unconfiguredLlmClient } from '../llm/LlmClient.js';
import { parseIntent, type IntentTelemetry } from '../intent/parseIntent.js';
import { INTENT_PROMPT_VERSION } from '../intent/prompt.js';
import { knownNeighborhoodsOf } from '../intent/validateIntent.js';
import { loadIntentCases, saveResult } from './evalCases.js';

// Regression gate for CI: exit non-zero when exact matches fall below this.
const minExactArg = process.argv.find((a) => a.startsWith('--min-exact='))?.split('=')[1];
const minExact = minExactArg === undefined ? null : Number(minExactArg);

const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
const mode = modeArg ?? (env.LLM_API_KEY ? 'llm' : 'fallback');
if (mode !== 'llm' && mode !== 'fallback') throw new Error(`unknown --mode=${mode}`);
const llm = mode === 'llm' ? createLlmClient() : unconfiguredLlmClient;
if (mode === 'llm' && llm === unconfiguredLlmClient) throw new Error('--mode=llm needs LLM_API_KEY');

const cases = loadIntentCases();
const knownNeighborhoods = knownNeighborhoodsOf(loadDataset().deals);

type Row = {
  id: number;
  tags: string[];
  input: string;
  result: IntentResult;
  telemetry: IntentTelemetry;
  wrong: string[];
};
const rows: Row[] = [];
const fieldStats = Object.fromEntries(
  QUERY_FIELDS.map((f) => [f, { relevant: 0, correct: 0, missed: 0, wrong: 0, spurious: 0 }]),
) as Record<QueryField, { relevant: number; correct: number; missed: number; wrong: number; spurious: number }>;
const checks = { clarification: { relevant: 0, correct: 0 }, cityAsWritten: { relevant: 0, correct: 0 } };

for (const c of cases) {
  const { result, telemetry } = await parseIntent(c.input, { llm, knownNeighborhoods });
  const wrong: string[] = [];
  for (const f of QUERY_FIELDS) {
    const exp = c.expected[f];
    const got = result.draft[f];
    if (exp === undefined && got === undefined) continue;
    const s = fieldStats[f];
    s.relevant++;
    if (exp === got) s.correct++;
    else {
      wrong.push(`${f}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
      if (got === undefined) s.missed++;
      else if (exp === undefined) s.spurious++;
      else s.wrong++;
    }
  }
  if (c.expectClarification !== undefined) {
    checks.clarification.relevant++;
    if (Boolean(result.clarificationNeeded) === c.expectClarification) checks.clarification.correct++;
    else wrong.push(`clarification: expected ${c.expectClarification}`);
  }
  if (c.expectCityAsWritten !== undefined) {
    checks.cityAsWritten.relevant++;
    if (result.cityAsWritten === c.expectCityAsWritten) checks.cityAsWritten.correct++;
    else wrong.push(`cityAsWritten: expected ${c.expectCityAsWritten}, got ${result.cityAsWritten}`);
  }
  rows.push({ id: c.id, tags: c.tags, input: c.input, result, telemetry, wrong });
  process.stdout.write(wrong.length ? 'x' : '.');
}
console.log('\n');

const pct = (a: number, b: number) => (b === 0 ? '   -' : `${((100 * a) / b).toFixed(0).padStart(3)}%`);
console.log(`mode=${mode} model=${llm.model} prompt=${INTENT_PROMPT_VERSION} cases=${cases.length}\n`);
console.log('field            relevant  correct  acc   missed wrong spurious');
for (const f of QUERY_FIELDS) {
  const s = fieldStats[f];
  if (s.relevant === 0) continue;
  console.log(
    `${f.padEnd(16)} ${String(s.relevant).padStart(8)} ${String(s.correct).padStart(8)}  ${pct(s.correct, s.relevant)} ${String(s.missed).padStart(6)} ${String(s.wrong).padStart(5)} ${String(s.spurious).padStart(8)}`,
  );
}
for (const [name, s] of Object.entries(checks)) {
  console.log(
    `${name.padEnd(16)} ${String(s.relevant).padStart(8)} ${String(s.correct).padStart(8)}  ${pct(s.correct, s.relevant)}`,
  );
}
const exact = rows.filter((r) => r.wrong.length === 0).length;
console.log(`\nexact match: ${exact}/${rows.length} (${pct(exact, rows.length).trim()})`);

const fellBack = rows.filter((r) => r.result.source === 'fallback');
if (mode === 'llm') {
  const ok = rows.filter((r) => r.telemetry.usage);
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const stat = (xs: number[]) => {
    const s = sorted(xs);
    const avg = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return `avg ${avg.toFixed(0)}  p50 ${s[Math.floor(s.length / 2)] ?? 0}  max ${s[s.length - 1] ?? 0}`;
  };
  console.log(
    `\nLLM calls: ${rows.filter((r) => r.telemetry.llmCalled).length}, fell back: ${fellBack.length} (${fellBack.map((r) => `#${r.id}:${r.result.fallbackReason}`).join(', ') || 'none'})`,
  );
  console.log(`input tokens   ${stat(ok.map((r) => r.telemetry.usage!.inputTokens))}`);
  console.log(`output tokens  ${stat(ok.map((r) => r.telemetry.usage!.outputTokens))}`);
  console.log(`latency ms     ${stat(rows.filter((r) => r.telemetry.latencyMs).map((r) => r.telemetry.latencyMs!))}`);
  console.log(`(timeout is ${config.llm.intentTimeoutMs} ms)`);
}

console.log('\nfailures:');
for (const r of rows.filter((x) => x.wrong.length))
  console.log(`  #${r.id} [${r.tags.join(',')}] ${r.input}\n      ${r.wrong.join('\n      ')}`);

const outFile = saveResult(`intent-${mode}`, {
  mode,
  model: llm.model,
  promptVersion: INTENT_PROMPT_VERSION,
  fieldStats,
  checks,
  exact,
  rows,
});
console.log(`\nsaved ${outFile}`);

if (minExact !== null && exact < minExact) {
  console.error(`\nFAIL: ${exact} exact matches, below the gate of ${minExact}`);
  process.exitCode = 1;
}
