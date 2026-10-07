import type { FactId, FactSheet, Verdict } from '@fpc/shared';
import { config } from '../config.js';

// Deterministic checks on the model's raw text (placeholders not yet expanded).
// A violation never reaches the user: it triggers one retry, then the template.
// The checks err on the side of rejecting — a false positive only costs us the
// LLM wording (the template still answers), a false negative could show the
// user an unsupported claim.

export type ViolationRule =
  | 'empty'
  | 'too_long'
  | 'not_hebrew'
  | 'digit'
  | 'number_word'
  | 'unknown_placeholder'
  | 'malformed_placeholder'
  | 'banned_claim'
  | 'contradicts_verdict'
  | 'asking_without_price'
  | 'verdict_missing';

export type Violation = { rule: ViolationRule; paragraph: number; detail: string };
export type GuardResult = { ok: boolean; violations: Violation[] };

export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// ---- Hebrew word matching -------------------------------------------------
// Hebrew glues prepositions/conjunctions/articles to the next word (ו, ה, ב, ל,
// מ, ש, כ), so "המחירים", "שהמחיר", "ובעתיד" must all match their base word.
const HE_PREFIX = '[ובלמהשכ]{0,3}';
const NOT_LETTER_BEFORE = '(?<![\\p{L}])';
const NOT_LETTER_AFTER = '(?![\\p{L}])';

/** Whole word (with optional Hebrew prefixes). Spaces in the phrase match any whitespace. */
const word = (w: string) =>
  new RegExp(`${NOT_LETTER_BEFORE}${HE_PREFIX}${w.replace(/ /g, '\\s+')}${NOT_LETTER_AFTER}`, 'u');
/** Word start (with prefixes), any suffix: inflections like יוקרתי/יוקרתית/יוקרתיים. */
const stem = (w: string) => new RegExp(`${NOT_LETTER_BEFORE}${HE_PREFIX}${w.replace(/ /g, '\\s+')}`, 'u');

/** Numbers written as words would bypass the digit check. */
const NUMBER_WORDS = [
  'שתיים',
  'שניים',
  'שלוש',
  'שלושה',
  'ארבע',
  'ארבעה',
  'חמש',
  'חמישה',
  'שש',
  'שישה',
  'שבע',
  'שבעה',
  'שמונה',
  'תשע',
  'תשעה',
  'עשר',
  'עשרה',
  'עשרים',
  'שלושים',
  'ארבעים',
  'חמישים',
  'שישים',
  'שבעים',
  'שמונים',
  'תשעים',
  'מאה',
  'מאות',
  'אלף',
  'אלפים',
  'אלפי',
  'מיליון',
  'מיליונים',
  'מיליוני',
  'מיליארד',
  'אחוז',
  'אחוזים',
  'רבע',
  'שליש',
  'מחצית',
  'חצי',
  'עשרות',
  'תריסר',
  'אחד',
  'אחת',
  'שני',
  'שתי',
  'שלושת',
  'ארבעת',
  'חמשת',
  'ששת',
  'שבעת',
  'שמונת',
  'תשעת',
  'עשרת',
].map((w) => ({ w, re: word(w) }));

/** Claims the data cannot support. Category → patterns. */
export const BANNED_CLAIMS: Record<string, RegExp[]> = {
  // Prices over time: 518 deals over 5 years can't support a trend.
  trend: [
    'מחירים עולים',
    'המחירים עולים',
    'מחירים יורדים',
    'המחירים יורדים',
    'עלייה במחירים',
    'ירידה במחירים',
    'עליית מחירים',
    'ירידת מחירים',
    'מגמה',
    'מגמת',
    'התייקר',
    'התייקרות',
    'הוזל',
    'הוזלה',
    'זינוק',
    'צניחה',
    'בשנים האחרונות',
    'לאורך השנים',
  ].map(stem),
  // Predictions.
  future: ['בעתיד', 'תחזית', 'יעלו', 'ירדו', 'יתייקר', 'יוזל', 'בשנה הבאה', 'בקרוב', 'ישתלם'].map(stem),
  // Neighborhood/area quality — not in the data.
  // Not the bare stem "מבוקש": "המחיר המבוקש" (the asking price) is the same word.
  neighborhood_quality: [
    'שכונה מבוקשת',
    'אזור מבוקש',
    'מבוקשת מאוד',
    'מבוקש מאוד',
    'ביקוש',
    'יוקרתי',
    'יוקרה',
    'אטרקטיבי',
    'איכותי',
    'שקט',
    'מתפתח',
    'בתי ספר',
    'תחבורה',
    'קרוב לים',
    'אווירה',
    'קהילה',
  ]
    .map(stem)
    .concat(['נוף'].map(word)),
  // Street names are repeated across all cities in this dataset — meaningless.
  street: ['רחוב', 'הרחוב'].map(word),
  // Advice we're not qualified to give.
  advice: [
    'משכנת',
    'עורך דין',
    'עורכי דין',
    'עו"ד',
    'מס רכישה',
    'מיסוי',
    'ייעוץ',
    'השקעה',
    'כדאי לקנות',
    'מומלץ לקנות',
    'לא כדאי',
    'להתמקח',
    'משא ומתן',
    'מציאה',
    'עסקה טובה',
  ].map(stem),
  // Overclaiming certainty from a handful of deals.
  certainty: ['בוודאות', 'ללא ספק', 'אין ספק', 'מובטח', 'בטוח ש'].map(stem),
};

// ---- Verdict direction ----------------------------------------------------
// Only checked in sentences about the asking price, so "the upper quartile is
// high" in a below-range explanation isn't a contradiction.
// Adjectives as stems (יקר/יקרה/יקרים); "מעל"/"מתחת" as whole words ("מעלית" is an elevator).
const dir = (w: string, whole = false) =>
  new RegExp(`${NOT_LETTER_BEFORE}[וה]?${w.replace(/ /g, '\\s+')}${whole ? NOT_LETTER_AFTER : ''}`, 'u');
const UP = [dir('גבוה'), dir('יקר'), dir('מעל', true), dir('עולה על'), dir('יותר מ')];
const DOWN = [dir('נמוך'), dir('זול'), dir('מתחת', true), dir('פחות מ'), dir('הנחה')];
const OUT_OF_RANGE = ['מחוץ לטווח', 'מעל הטווח', 'מעל לטווח', 'מתחת לטווח', 'יקר מדי', 'זול מדי', 'חורג'].map((w) =>
  dir(w),
);
const ASKING_FACTS: FactId[] = ['asking_price', 'asking_vs_median_pct'];
const ASKING_WORDS = /המבוקש|מבקשים|מחיר הדרישה|המחיר שנדרש/u;

const splitSentences = (p: string) =>
  p
    .split(/[.!?;:\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function aboutAskingPrice(sentence: string): boolean {
  if (ASKING_WORDS.test(sentence)) return true;
  return [...sentence.matchAll(PLACEHOLDER_RE)].some((m) => ASKING_FACTS.includes(m[1] as FactId));
}

export function factGuard(paragraphs: string[], ctx: { facts: FactSheet; verdict: Verdict | null }): GuardResult {
  const violations: Violation[] = [];
  const add = (rule: ViolationRule, paragraph: number, detail: string) => violations.push({ rule, paragraph, detail });

  const nonEmpty = paragraphs.map((p) => p.trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    add('empty', 0, 'no text');
    return { ok: false, violations };
  }
  if (nonEmpty.length > config.explain.maxParagraphs) {
    add('too_long', 0, `${nonEmpty.length} paragraphs, max ${config.explain.maxParagraphs}`);
  }
  const totalChars = nonEmpty.reduce((n, p) => n + p.length, 0);
  if (totalChars > config.explain.maxChars) add('too_long', 0, `${totalChars} chars, max ${config.explain.maxChars}`);

  let usedAskingFact = false;
  nonEmpty.forEach((p, i) => {
    const n = i + 1;
    for (const m of p.matchAll(PLACEHOLDER_RE)) {
      const id = m[1]!;
      if (!(id in ctx.facts)) add('unknown_placeholder', n, `{{${id}}} is not an available fact`);
      if (ASKING_FACTS.includes(id as FactId)) usedAskingFact = true;
    }

    const prose = p.replace(PLACEHOLDER_RE, ' ');
    if (/[{}]/.test(prose)) add('malformed_placeholder', n, 'stray "{" or "}" — use {{fact_id}} exactly');
    // Whole numbers incl. separators ("3,900,000"), so retry feedback quotes them as written.
    // Also Arabic-Indic digits (U+0660–0669, U+06F0–06F9).
    const digits = prose.match(/[0-9٠-٩۰-۹](?:[0-9.,]*[0-9])?/g);
    if (digits) add('digit', n, `digits "${digits.join(', ')}" — numbers must be placeholders`);
    if (/[A-Za-z]/.test(prose)) add('not_hebrew', n, 'Latin letters outside placeholders');
    if (!/[֐-׿]/.test(prose)) add('not_hebrew', n, 'no Hebrew text');

    for (const { w, re } of NUMBER_WORDS) if (re.test(prose)) add('number_word', n, `number word "${w}"`);
    for (const [category, patterns] of Object.entries(BANNED_CLAIMS)) {
      for (const re of patterns) {
        const m = re.exec(prose);
        if (m) add('banned_claim', n, `${category}: "${m[0].trim()}"`);
      }
    }

    for (const sentence of splitSentences(p)) {
      const asking = aboutAskingPrice(sentence);
      if (asking && ctx.verdict === null)
        add('asking_without_price', n, 'mentions an asking price, but none was given');
      if (!asking || ctx.verdict === null) continue;
      const text = sentence.replace(PLACEHOLDER_RE, ' ');
      const hit = (res: RegExp[]) => res.map((r) => r.exec(text)?.[0].trim()).find(Boolean);
      const wrong =
        ctx.verdict === 'below_range' ? hit(UP) : ctx.verdict === 'above_range' ? hit(DOWN) : hit(OUT_OF_RANGE);
      if (wrong) add('contradicts_verdict', n, `"${wrong}" contradicts verdict ${ctx.verdict}`);
    }
  });

  if (ctx.verdict !== null && !usedAskingFact) {
    add('verdict_missing', 0, 'an asking price was given; reference {{asking_price}} or {{asking_vs_median_pct}}');
  }
  return { ok: violations.length === 0, violations };
}
