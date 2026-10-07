import { describe, expect, it } from 'vitest';
import { factGuard, type ViolationRule } from './factGuard.js';
import { EXPLAIN_SYSTEM_PROMPT } from './prompt.js';
import { buildTemplateParagraphs } from './template.js';
import { ANALYSES } from './testAnalyses.js';

const { below, above, within, noAsking } = ANALYSES;
const ctx = (a = below) => ({ facts: a.facts, verdict: a.verdict?.verdict ?? null });
const rules = (paragraphs: string[], a = below) => factGuard(paragraphs, ctx(a)).violations.map((v) => v.rule);

const SCOPE = 'ההשוואה מבוססת על {{n_comps}} של {{scope_label}}.';
const BELOW = 'המחיר המבוקש, {{asking_price}}, נמוך מהטווח: {{asking_vs_median_pct}} מתחת לחציון.';

describe('factGuard — passes', () => {
  it('clean placeholder text', () => {
    expect(factGuard([SCOPE, BELOW], ctx())).toEqual({ ok: true, violations: [] });
  });

  it('digits inside fact ids ({{p25_ppsqm}}) are not "digits in text"', () => {
    expect(rules([SCOPE, 'הרבעון התחתון הוא {{p25_ppsqm}} למ״ר.', BELOW])).toEqual([]);
  });

  it('"המחיר המבוקש" is not the banned "מבוקש" (in demand)', () => {
    expect(rules([SCOPE, BELOW])).toEqual([]);
  });

  it('"מעלית" (elevator) is not "מעל" (above)', () => {
    expect(rules([SCOPE, 'המחיר המבוקש לדירה עם מעלית, {{asking_price}}, נמוך מהטווח.'])).toEqual([]);
  });

  it('direction words outside asking-price sentences are fine ("the upper quartile is high")', () => {
    expect(rules([SCOPE, 'הגבול העליון, {{estimate_high}}, גבוה מהחציון.', BELOW])).toEqual([]);
  });

  it('"הרבעון" is not the number word "רבע"', () => {
    expect(rules([SCOPE, 'הטווח בין הרבעון התחתון לעליון.', BELOW])).toEqual([]);
  });

  it('the example in the system prompt passes for an above-range analysis', () => {
    const json = EXPLAIN_SYSTEM_PROMPT.slice(EXPLAIN_SYSTEM_PROMPT.lastIndexOf('{"paragraphs"'));
    const { paragraphs } = JSON.parse(json) as { paragraphs: string[] };
    expect(factGuard(paragraphs, ctx(above))).toEqual({ ok: true, violations: [] });
  });
});

describe('factGuard — rejects', () => {
  it.each<[string, string[], ViolationRule]>([
    ['a raw number', [SCOPE, 'המחיר המבוקש, 3,900,000 ₪, נמוך מהטווח {{asking_vs_median_pct}}.'], 'digit'],
    [
      'a number in words',
      [SCOPE, 'המחיר המבוקש נמוך בכשלושה מיליון מ-{{estimate_low}} {{asking_price}}.'],
      'number_word',
    ],
    ['"אחוז" written out', [SCOPE, 'המחיר המבוקש {{asking_price}} נמוך בעשרים אחוז.'], 'number_word'],
    ['an invented placeholder', [SCOPE, 'המחיר הממוצע הוא {{avg_price}}.', BELOW], 'unknown_placeholder'],
    [
      'a single-brace placeholder',
      [SCOPE, 'המחיר המבוקש {asking_price} נמוך מהטווח {{asking_vs_median_pct}}.'],
      'malformed_placeholder',
    ],
    ['English', [SCOPE, 'The asking price {{asking_price}} is low.', BELOW], 'not_hebrew'],
    ['too many paragraphs', [SCOPE, SCOPE, SCOPE, BELOW], 'too_long'],
    ['nothing at all', [], 'empty'],
  ])('%s', (_name, paragraphs, rule) => {
    expect(rules(paragraphs)).toContain(rule);
  });

  it.each([
    ['trend', 'המחירים עולים בשנים האחרונות.'],
    ['trend (inflected)', 'יש מגמה של התייקרות באזור.'],
    ['future', 'בעתיד המחיר עשוי להשתנות.'],
    ['neighborhood quality', 'זו שכונה מבוקשת ושקטה.'],
    ['street', 'ברחוב הזה יש עסקאות רבות.'],
    ['mortgage advice', 'כדאי לבדוק את המשכנתא.'],
    ['buy advice', 'כדאי לקנות עכשיו.'],
    ['negotiation advice', 'אפשר להתמקח על המחיר.'],
    ['certainty', 'זה בוודאות מחיר טוב.'],
  ])('banned claim: %s', (_name, sentence) => {
    expect(rules([SCOPE, sentence, BELOW])).toContain('banned_claim');
  });

  it('below_range text that calls the asking price high', () => {
    expect(rules([SCOPE, 'המחיר המבוקש, {{asking_price}}, גבוה מהטווח: {{asking_vs_median_pct}}.'])).toContain(
      'contradicts_verdict',
    );
  });

  it('above_range text that calls the asking price cheap', () => {
    expect(rules([SCOPE, 'המחיר המבוקש {{asking_price}} זול יחסית, {{asking_vs_median_pct}}.'], above)).toContain(
      'contradicts_verdict',
    );
  });

  it('within_range text that says out of range', () => {
    expect(rules([SCOPE, 'המחיר המבוקש {{asking_price}} מחוץ לטווח, {{asking_vs_median_pct}}.'], within)).toContain(
      'contradicts_verdict',
    );
  });

  it('mentioning an asking price when none was given', () => {
    expect(rules([SCOPE, 'המחיר המבוקש סביר.'], noAsking)).toContain('asking_without_price');
  });

  it('ignoring the verdict when an asking price was given', () => {
    expect(rules([SCOPE, 'הטווח הוא בין {{estimate_low}} ל-{{estimate_high}}.'])).toEqual(['verdict_missing']);
  });

  it('referencing a fact that does not exist for this analysis (asking price, none given)', () => {
    expect(rules([SCOPE, 'הטווח הוא {{estimate_low}} עד {{asking_price}}.'], noAsking)).toContain(
      'unknown_placeholder',
    );
  });

  it('returns details, not just a boolean', () => {
    const res = factGuard([SCOPE, 'המחיר המבוקש, 3,900,000 ₪, נמוך מהטווח {{asking_vs_median_pct}}.'], ctx());
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toEqual({ rule: 'digit', paragraph: 2, detail: expect.stringContaining('3,900,000') });
  });
});

describe('every template variant passes the guard', () => {
  it('the fixtures really cover each branch', () => {
    const A = ANALYSES;
    expect([A.below, A.within, A.withinAbove, A.above].map((x) => x.verdict?.verdict)).toEqual([
      'below_range',
      'within_range',
      'within_range',
      'above_range',
    ]);
    expect(A.within.verdict!.askingVsMedian).toBe(0); // "כמעט זהה לחציון" branch
    expect(A.noAsking.verdict).toBeNull();
    expect(A.priceBasis.basis).toBe('price');
    expect(A.lowWithOutlier.confidence).toBe('LOW');
    expect(A.lowWithOutlier.facts.n_outliers_excluded).toBeDefined();
    expect(A.insufficient.confidence).toBe('INSUFFICIENT');
  });

  it.each(Object.entries(ANALYSES))('%s', (_name, a) => {
    expect(factGuard(buildTemplateParagraphs(a), ctx(a))).toEqual({ ok: true, violations: [] });
  });
});
