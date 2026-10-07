// Field parsers for the deals CSV — pure, one per field, no dataset knowledge.
import { z } from 'zod';
import { SOURCES, resolveNeighborhoodAlias, type CanonicalCity, type DatePrecision, type Source } from '@fpc/shared';
import { config } from '../config.js';

const cfg = config.data;

// ---------------------------------------------------------------------------
// Raw row schema: every column is a string; we only check the shape here.
// ---------------------------------------------------------------------------

export const RawRowSchema = z.object({
  deal_id: z.string(),
  city: z.string(),
  neighborhood: z.string(),
  street: z.string(),
  property_type: z.string(),
  rooms: z.string(),
  size_sqm: z.string(),
  floor: z.string(),
  total_floors: z.string(),
  year_built: z.string(),
  condition: z.string(),
  has_elevator: z.string(),
  has_parking: z.string(),
  has_balcony: z.string(),
  has_safe_room: z.string(),
  deal_date: z.string(),
  price_nis: z.string(),
  price_per_sqm: z.string(),
  source: z.string(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

// ---------------------------------------------------------------------------
// Field parsers — pure, one per field.
// ---------------------------------------------------------------------------

/** Trim + collapse inner whitespace; empty → null. */
export function cleanText(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** Strips "₪", thousands separators and spaces. Returns null if anything else remains. */
export function parsePrice(raw: string): {
  value: number | null;
  hadCommas: boolean;
  hadShekel: boolean;
} {
  const hadCommas = raw.includes(',');
  const hadShekel = raw.includes('₪');
  const digits = raw.replace(/[₪,\s]/g, '');
  const value = /^\d+$/.test(digits) ? Number(digits) : null;
  return { value, hadCommas, hadShekel };
}

/** "4", "3.5", "4 חדרים" → number; must be within range and a multiple of 0.5. */
export function parseRooms(raw: string): {
  value: number | null;
  hadSuffix: boolean;
  invalid: boolean;
} {
  const s = raw.trim();
  if (s === '') return { value: null, hadSuffix: false, invalid: false };
  const m = /^(\d+(?:\.\d+)?)\s*(חדרים|חדר|חד['׳])?$/.exec(s);
  const hadSuffix = Boolean(m?.[2]);
  const n = m ? Number(m[1]) : NaN;
  const ok = Number.isFinite(n) && n >= cfg.roomsMin && n <= cfg.roomsMax && Number.isInteger(n * 2);
  return { value: ok ? n : null, hadSuffix, invalid: !ok };
}

const TRUE_SPELLINGS = new Set(['כן', 'yes', 'true', '1']);
const FALSE_SPELLINGS = new Set(['לא', 'no', 'false', '0']);

/** Tri-state: true / false / null (unknown). Unknown is never treated as "no". */
export function parseTriState(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (TRUE_SPELLINGS.has(s)) return true;
  if (FALSE_SPELLINGS.has(s)) return false;
  return null;
}

/** Non-negative-or-negative integer, or null for empty / non-integer input. */
export function parseIntOrNull(raw: string): number | null {
  const s = raw.trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

export function parseSizeSqm(raw: string): { value: number | null; outOfRange: boolean } {
  const s = raw.trim();
  if (s === '') return { value: null, outOfRange: false };
  const n = Number(s);
  const ok = Number.isFinite(n) && n >= cfg.sizeSqmMin && n <= cfg.sizeSqmMax;
  return { value: ok ? n : null, outOfRange: !ok };
}

export function parseYearBuilt(raw: string, today: string): number | null {
  const n = parseIntOrNull(raw);
  const currentYear = Number(today.slice(0, 4));
  return n !== null && n >= cfg.yearBuiltMin && n <= currentYear ? n : null;
}

// ----- Dates: one explicit parser per format, never a "smart" parser. -----

export type DateFormat = 'iso' | 'dot' | 'slash' | 'monthYear';
export type ParsedDate = {
  date: string; // YYYY-MM-DD
  precision: DatePrecision;
  format: DateFormat;
  /** dot/slash dates where both parts are ≤ 12 — resolved day-first by convention. */
  ambiguous: boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Returns ISO date if y-m-d is a real calendar date, else null (rejects e.g. 31.02). */
function isoIfValid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `2025-09-07` → year-month-day. */
export function parseIsoDate(raw: string): ParsedDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const date = isoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));
  return date ? { date, precision: 'day', format: 'iso', ambiguous: false } : null;
}

/** `17.07.2026` / `15/06/2025` → day-first (Israeli convention). */
export function parseDayFirstDate(raw: string, sep: '.' | '/'): ParsedDate | null {
  const s = sep === '.' ? '\\.' : '/';
  const m = new RegExp(`^(\\d{1,2})${s}(\\d{1,2})${s}(\\d{4})$`).exec(raw.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const date = isoIfValid(Number(m[3]), month, day);
  if (!date) return null;
  return {
    date,
    precision: 'day',
    format: sep === '.' ? 'dot' : 'slash',
    ambiguous: day <= 12 && month <= 12,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Aug 2025` → 2025-08-01 with month precision. */
export function parseMonthYear(raw: string): ParsedDate | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1]!);
  if (idx === -1) return null;
  return { date: `${m[2]}-${pad(idx + 1)}-01`, precision: 'month', format: 'monthYear', ambiguous: false };
}

/** Dispatches on the format's shape; each shape has exactly one parser. */
export function parseDealDate(
  raw: string,
  today: string,
): { ok: true; value: ParsedDate } | { ok: false; reason: 'date_unparseable' | 'date_in_future' } {
  const s = raw.trim();
  const parsed = /^\d{4}-/.test(s)
    ? parseIsoDate(s)
    : s.includes('.')
      ? parseDayFirstDate(s, '.')
      : s.includes('/')
        ? parseDayFirstDate(s, '/')
        : parseMonthYear(s);
  if (!parsed) return { ok: false, reason: 'date_unparseable' };
  if (parsed.date > today) return { ok: false, reason: 'date_in_future' };
  return { ok: true, value: parsed };
}

/** Trim/collapse whitespace, then apply the per-city alias table (e.g. "Florentin" → "פלורנטין"). */
export function neighborhoodOf(city: CanonicalCity, raw: string): string | null {
  const cleaned = cleanText(raw);
  return cleaned === null ? null : resolveNeighborhoodAlias(city, cleaned);
}

export function recomputePricePerSqm(priceNis: number, sizeSqm: number | null): number | null {
  return sizeSqm ? priceNis / sizeSqm : null;
}

/** Lower index in SOURCES = more trusted. */
export function sourceRank(source: Source): number {
  return SOURCES.indexOf(source);
}
