// Hebrew number/date formatting. Used by the API to build facts and by the web
// app for tables, so the same value always looks the same.
// Intl he-IL output contains RLM marks (U+200F) and puts ₪ after the number;
// render inside <bdi> in the UI.

const currency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});
const currencyCompact = new Intl.NumberFormat('he-IL', {
  notation: 'compact',
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 0 });
const monthYear = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatNis = (n: number): string => currency.format(n);
/** "3.9M ₪" — for chips, where space is short. */
export const formatNisCompact = (n: number): string => currencyCompact.format(n);
export const formatInt = (n: number): string => integer.format(n);
/** `ratio` is a fraction: 0.12 → "12%". */
export const formatPercent = (ratio: number): string => percent.format(ratio);
export const formatSqm = (n: number): string => `${integer.format(n)} מ״ר`;
export const formatNisPerSqm = (n: number): string => `${currency.format(n)} למ״ר`;

/** "4" → "4 חדרים", "3.5" → "3.5 חדרים", "1" → "חדר אחד". */
export function formatRooms(n: number): string {
  return n === 1 ? 'חדר אחד' : `${n} חדרים`;
}

/** Hebrew plural of "deal". */
export function formatDealCount(n: number): string {
  return n === 1 ? 'עסקה אחת' : `${integer.format(n)} עסקאות`;
}

/** ISO date + precision → "12.2.2026" (day) or "פברואר 2026" (month). */
export function formatDealDate(isoDate: string, precision: 'day' | 'month'): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return precision === 'month' ? monthYear.format(d) : fullDate.format(d);
}

/**
 * "3.5–4.5" / "2021–2026" inside Hebrew text. Without isolation the en dash is
 * direction-neutral and an RTL paragraph flips the two numbers ("4.5–3.5").
 * Wrapped in LRI…PDI (U+2066/U+2069) so the range always reads low→high.
 */
export const formatRange = (a: string | number, b: string | number): string => `\u2066${a}–${b}\u2069`;

/** Removes bidi control marks — for comparisons and tests, not for display. */
export function stripBidi(s: string): string {
  return s.replace(/[‎‏‪-‮⁦-⁩]/g, '');
}
