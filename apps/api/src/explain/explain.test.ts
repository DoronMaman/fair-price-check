import { describe, expect, it, vi } from 'vitest';
import { ExplanationSchema, stripBidi, type AnalysisResult } from '@fpc/shared';
import { LlmError, unconfiguredLlmClient, type LlmClient, type LlmJsonRequest } from '../llm/LlmClient.js';
import { explain, templateExplanation } from './explain.js';
import type { ExplanationLlmOutput } from './prompt.js';
import { toPlainText } from './render.js';
import { ANALYSES } from './testAnalyses.js';

const a = ANALYSES.below;
const GOOD: ExplanationLlmOutput = {
  paragraphs: [
    'ההשוואה מבוססת על {{n_comps}} של {{scope_label}}, בין {{date_from}} ל{{date_to}}.',
    'המחיר המבוקש, {{asking_price}}, נמוך מהטווח המשוער: {{asking_vs_median_pct}} מתחת לחציון.',
  ],
  usedFactIds: ['n_comps', 'scope_label', 'date_from', 'date_to', 'asking_price', 'asking_vs_median_pct'],
};
const RAW_NUMBER: ExplanationLlmOutput = {
  paragraphs: ['ההשוואה מבוססת על 8 עסקאות.', 'המחיר המבוקש, 3,900,000 ₪, נמוך מהטווח {{asking_vs_median_pct}}.'],
  usedFactIds: ['asking_vs_median_pct'],
};
const INVENTED: ExplanationLlmOutput = {
  paragraphs: [...GOOD.paragraphs, 'המחיר הממוצע בעיר הוא {{city_avg_price}}.'],
  usedFactIds: ['city_avg_price'],
};
const TREND: ExplanationLlmOutput = {
  paragraphs: [...GOOD.paragraphs.slice(0, 1), 'המחירים עולים בשנים האחרונות, ' + GOOD.paragraphs[1]],
  usedFactIds: GOOD.usedFactIds,
};

/** A mock LLM that returns the given outputs in order (or throws them). */
function scripted(...outputs: (ExplanationLlmOutput | Error)[]) {
  const calls: LlmJsonRequest<unknown>[] = [];
  const llm: LlmClient = {
    model: 'mock',
    generateJson: vi.fn(async (req: LlmJsonRequest<unknown>) => {
      calls.push(req);
      const next = outputs[calls.length - 1];
      if (next === undefined) throw new Error('unexpected extra call');
      if (next instanceof Error) throw next;
      return { data: next, usage: { inputTokens: 700, outputTokens: 200 }, latencyMs: 5, model: 'mock' };
    }) as LlmClient['generateJson'],
  };
  return { llm, calls };
}

function expectTemplate(res: Awaited<ReturnType<typeof explain>>, analysis: AnalysisResult, reason: string) {
  expect(res.explanation).toEqual(templateExplanation(analysis, reason as never));
  expect(res.explanation.source).toBe('template');
  expect(ExplanationSchema.parse(res.explanation)).toBeTruthy();
  expect(toPlainText(res.explanation.paragraphs)).not.toMatch(/\{|\}/);
}

describe('explain — acceptance: bad LLM output always ends in the template', () => {
  it('writes a raw number (twice) → template', async () => {
    const { llm, calls } = scripted(RAW_NUMBER, RAW_NUMBER);
    const res = await explain(a, { llm });
    expectTemplate(res, a, 'guard_failed');
    expect(calls).toHaveLength(2);
    for (const attempt of res.telemetry.attempts) {
      expect(new Set(attempt.violations.map((v) => v.rule))).toEqual(new Set(['digit']));
    }
  });

  it('invents a placeholder (twice) → template', async () => {
    const { llm } = scripted(INVENTED, INVENTED);
    expectTemplate(await explain(a, { llm }), a, 'guard_failed');
  });

  it('claims a price trend (twice) → template', async () => {
    const { llm } = scripted(TREND, TREND);
    const res = await explain(a, { llm });
    expectTemplate(res, a, 'guard_failed');
    expect(res.telemetry.attempts[0]!.violations[0]).toMatchObject({ rule: 'banned_claim' });
  });

  it('times out → template, no retry', async () => {
    const { llm, calls } = scripted(new LlmError('timeout', 'took too long'));
    const res = await explain(a, { llm });
    expectTemplate(res, a, 'timeout');
    expect(calls).toHaveLength(1);
  });
});

describe('explain — retry', () => {
  it('feeds the violations back and accepts a fixed second answer', async () => {
    const { llm, calls } = scripted(RAW_NUMBER, GOOD);
    const res = await explain(a, { llm });
    expect(res.explanation.source).toBe('llm');
    expect(calls[1]!.user).toContain('rejected by an automatic check');
    expect(calls[1]!.user).toContain('digit');
    expect(calls[1]!.purpose).toBe('explain_retry');
  });

  it('skips the retry when the time budget is nearly spent', async () => {
    let t = 0;
    const { llm, calls } = scripted(RAW_NUMBER, GOOD);
    const res = await explain(a, { llm, deadline: 1_500, now: () => (t += 600) });
    expectTemplate(res, a, 'guard_failed');
    expect(calls).toHaveLength(1);
  });

  it('does not call at all when the deadline has passed', async () => {
    const { llm, calls } = scripted(GOOD);
    expectTemplate(await explain(a, { llm, deadline: 0, now: () => 10 }), a, 'timeout');
    expect(calls).toHaveLength(0);
  });
});

describe('explain — LLM success', () => {
  it('renders placeholders into code-formatted fact segments', async () => {
    const { llm } = scripted(GOOD);
    const res = await explain(a, { llm });
    expect(res.explanation.source).toBe('llm');
    const facts = res.explanation.paragraphs.flat().filter((s) => s.type === 'fact');
    expect(facts.map((s) => s.type === 'fact' && s.factId)).toEqual(GOOD.usedFactIds);
    expect(facts.find((s) => s.type === 'fact' && s.factId === 'asking_price')!.text).toBe(
      a.facts.asking_price!.formatted,
    );
    expect(stripBidi(toPlainText(res.explanation.paragraphs))).toContain('3,900,000');
  });

  it('sends fact descriptions to the model, never values or raw deals', async () => {
    const { llm, calls } = scripted(GOOD);
    await explain(a, { llm });
    const sent = calls[0]!.user;
    expect(sent).toContain('"id": "median_ppsqm"');
    expect(sent).not.toMatch(/\d{3,}/); // no prices, ids or dates
    expect(sent).not.toContain('D1');
  });
});

describe('explain — no LLM call', () => {
  it('INSUFFICIENT → template, LLM never called', async () => {
    const { llm, calls } = scripted(GOOD);
    expectTemplate(await explain(ANALYSES.insufficient, { llm }), ANALYSES.insufficient, 'insufficient_data');
    expect(calls).toHaveLength(0);
  });

  it('no API key → template', async () => {
    expectTemplate(await explain(a, { llm: unconfiguredLlmClient }), a, 'llm_not_configured');
  });

  it('circuit open → template, LLM never called', async () => {
    const { llm, calls } = scripted(GOOD);
    expectTemplate(await explain(a, { llm, skipLlm: 'circuit_open' }), a, 'circuit_open');
    expect(calls).toHaveLength(0);
  });
});

describe('templates', () => {
  it.each(Object.entries(ANALYSES))('%s renders to text with no placeholders left', (_name, analysis) => {
    const t = templateExplanation(analysis, 'llm_not_configured');
    expect(toPlainText(t.paragraphs)).not.toMatch(/\{|\}/);
    expect(t.paragraphs.length).toBeGreaterThan(0);
  });

  it('below-range example reads correctly', () => {
    const text = stripBidi(toPlainText(templateExplanation(ANALYSES.below, 'timeout').paragraphs)).replace(
      /\u00A0/g,
      ' ',
    );
    expect(text).toContain('ההשוואה מבוססת על 8 עסקאות של דירות עם 3.5–4.5 חדרים בגבעתיים');
    expect(text).toContain('המחיר המבוקש, 3,900,000 ₪, נמוך מהטווח הזה: 22% מתחת לחציון.');
  });
});
