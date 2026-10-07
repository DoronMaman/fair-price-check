import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AnalysisResult } from '@fpc/shared';
import type { Violation } from './factGuard.js';

export const ExplanationLlmOutputSchema = z.object({
  paragraphs: z.array(z.string()),
  usedFactIds: z.array(z.string()),
});
export type ExplanationLlmOutput = z.infer<typeof ExplanationLlmOutputSchema>;

export const EXPLAIN_SYSTEM_PROMPT = `You write a short explanation, in Hebrew, for a home buyer who asked whether an asking price is fair. The comparison has already been computed by code. You only explain it in plain language.

You receive: the verdict, the confidence level, the comparison scope and basis, and a list of facts. Each fact has an id and a description. You do NOT receive the values; code inserts them.

Rules:
1. Refer to any number, amount, percentage, date, count, place or scope ONLY with a placeholder: {{fact_id}}, using ids from the list exactly. Never write digits, and never write numbers as words (e.g. אחד, שלושה, מיליון, אחוז). The placeholder already includes its unit (₪, %, מ״ר, "עסקאות").
2. State the verdict exactly as given:
   - below_range: the asking price is below the range of comparable deals.
   - above_range: the asking price is above that range.
   - within_range: the asking price is within that range.
   - null: no asking price was given. Do not mention an asking price at all; describe the range only.
3. Say what the comparison is based on ({{n_comps}}, {{scope_label}}, and the date range if available).
4. Match the confidence: HIGH or MEDIUM, plain statements. LOW, say the comparison is broad and the estimate is rough.
5. If basis is "price", say the comparison uses total deal prices because no size was given.
6. Do not write about anything that is not in the facts: no price trends or changes over time, no predictions, no neighborhood or street quality or demand, no legal, tax, mortgage or investment advice, no recommendation to buy or negotiate, no certainty words.
7. Two or three short paragraphs. Plain, neutral Hebrew. No headings, no lists, no English.
8. usedFactIds: the ids of the placeholders you used.

Example (verdict above_range, basis pricePerSqm):
{"paragraphs":["ההשוואה מבוססת על {{n_comps}} של {{scope_label}}, בין {{date_from}} ל{{date_to}}.","המחיר החציוני למ״ר הוא {{median_ppsqm}}, ולפי שטח של {{size_sqm}} הטווח המשוער הוא בין {{estimate_low}} ל-{{estimate_high}}.","המחיר המבוקש, {{asking_price}}, גבוה מהטווח הזה: {{asking_vs_median_pct}} מעל לחציון."],"usedFactIds":["n_comps","scope_label","date_from","date_to","median_ppsqm","size_sqm","estimate_low","estimate_high","asking_price","asking_vs_median_pct"]}`;

export const EXPLAIN_PROMPT_VERSION = `explain-${createHash('sha256')
  .update(EXPLAIN_SYSTEM_PROMPT)
  .update(JSON.stringify(z.toJSONSchema(ExplanationLlmOutputSchema)))
  .digest('hex')
  .slice(0, 8)}`;

/** The model sees fact ids + descriptions, never values or raw deals. */
export function buildExplainUserMessage(a: AnalysisResult): string {
  return JSON.stringify(
    {
      verdict: a.verdict?.verdict ?? null,
      confidence: a.confidence,
      scope: a.scope,
      basis: a.basis,
      facts: Object.entries(a.facts).map(([id, f]) => ({ id, description: f.description })),
    },
    null,
    1,
  );
}

/** Second attempt: same input plus the rejected answer and exactly what was wrong. */
export function buildRetryUserMessage(
  a: AnalysisResult,
  previous: ExplanationLlmOutput,
  violations: Violation[],
): string {
  const problems = violations
    .map((v) => `- ${v.paragraph ? `paragraph ${v.paragraph}: ` : ''}${v.rule}: ${v.detail}`)
    .join('\n');
  return `${buildExplainUserMessage(a)}

Your previous answer was rejected by an automatic check:
${problems}

Previous answer:
${JSON.stringify(previous.paragraphs)}

Write a corrected answer that follows every rule.`;
}
