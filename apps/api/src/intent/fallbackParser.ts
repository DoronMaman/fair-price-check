import { CANONICAL_CITIES, CITY_ALIASES, canonicalCity, cityKey, type PropertyType } from '@fpc/shared';
import type { IntentCandidate } from './validateIntent.js';

// Deterministic parser used when the LLM is unavailable, slow or over budget.
// It covers the common, regular phrasings; anything it misses is fixed by the
// user in the editable chips. Its output goes through the same validateIntent().

const L = '\\p{L}\\p{N}';
/** Not preceded/followed by a letter or digit. */
const notAfterWord = `(?<![${L}])`;
const notBeforeWord = `(?![${L}])`;
const re = (src: string) => new RegExp(src, 'iu');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Hebrew prepositions/conjunctions glued to the next word: בגבעתיים, מחולון, ובת"א. */
const HE_PREFIX = '[ובלמהשכ]{0,2}';

/** Different cities whose names contain a known alias. */
const FALSE_FRIEND_SUFFIXES = [' עילית'];

// Longest first ("תל אביב יפו" before "תל אביב"); compiled once at module load, not per call.
const CITY_PATTERNS = [...new Set([...CANONICAL_CITIES, ...Object.keys(CITY_ALIASES)].map(cityKey))]
  .sort((a, b) => b.length - a.length)
  .map((key) => ({ key, re: new RegExp(`${notAfterWord}(${HE_PREFIX})(${escapeRe(key)})${notBeforeWord}`, 'giu') }));

/**
 * First city mentioned, preferring one written with the locative "ב" ("in"):
 * in "עברנו מחולון, מחפשים בגבעתיים" the property is in Givatayim.
 */
export function findCity(text: string): string | null {
  const t = cityKey(text);
  let best: { located: boolean; index: number; key: string } | null = null;
  for (const { key, re: pattern } of CITY_PATTERNS) {
    for (const m of t.matchAll(pattern)) {
      const after = t.slice(m.index + m[0].length);
      if (FALSE_FRIEND_SUFFIXES.some((s) => after.startsWith(s))) continue;
      const cand = { located: m[1]!.endsWith('ב'), index: m.index, key };
      if (!best || (cand.located && !best.located) || (cand.located === best.located && cand.index < best.index)) {
        best = cand;
      }
    }
  }
  return best ? canonicalCity(best.key) : null;
}

const HE_NUMBERS: Record<string, number> = {
  אחד: 1,
  אחת: 1,
  שניים: 2,
  שני: 2,
  שתיים: 2,
  שתי: 2,
  שלושה: 3,
  שלוש: 3,
  ארבעה: 4,
  ארבע: 4,
  חמישה: 5,
  חמש: 5,
  שישה: 6,
  שש: 6,
  שבעה: 7,
  שבע: 7,
};
const HE_NUMBER_WORDS = Object.keys(HE_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const ROOM_WORD = `(?:חדרים|חדר|חד'|חד|rooms?)${notBeforeWord}`;

export function findRooms(text: string): number | null {
  const digits = re(`(\\d+(?:\\.5)?)\\s*(וחצי)?\\s*${ROOM_WORD}`).exec(text);
  if (digits) return Number(digits[1]) + (digits[2] ? 0.5 : 0);
  const words = re(`(${HE_NUMBER_WORDS})\\s*(וחצי)?\\s*${ROOM_WORD}`).exec(text);
  if (words) return HE_NUMBERS[words[1]!]! + (words[2] ? 0.5 : 0);
  if (re(`חדר\\s*וחצי`).test(text)) return 1.5;
  return null;
}

export function findSize(text: string): number | null {
  const m = re(`(\\d+(?:\\.\\d+)?)\\s*(?:מ"ר|מ'ר|מר|מטר(?:ים)?|sqm|m2)${notBeforeWord}`).exec(text);
  return m ? Number(m[1]) : null;
}

export function findPrice(text: string): number | null {
  // "3.9 מיליון", "4.2M", "2 מיליון ו-750 אלף", "מיליון ו-200"
  // Scan all matches: a bare word ("פחות ממיליון", the "m" in "sqm") must not hide a real price later.
  const millionsRe = new RegExp(
    `(?:(\\d+(?:\\.\\d+)?)\\s*)?(?:מיליון|מליון|מיל'|million|m)${notBeforeWord}(?:\\s*ו\\s*-?\\s*(\\d{1,3})(?:\\s*אלף)?)?`,
    'giu',
  );
  for (const m of text.matchAll(millionsRe)) {
    if (m[1] || m[2]) return Math.round((Number(m[1] ?? 1) + Number(m[2] ?? 0) / 1000) * 1_000_000);
  }
  // "950 אלף", "850K"
  const thousands = re(`(\\d+(?:\\.\\d+)?)\\s*(?:אלף|k)${notBeforeWord}`).exec(text);
  if (thousands) return Math.round(Number(thousands[1]) * 1000);
  // "3,900,000", "3900000", "₪1,650,000"
  const full = re(`(?<![\\d.,])(\\d{1,3}(?:,\\d{3}){2,}|\\d{6,9})(?![\\d,])`).exec(text);
  if (full) return Number(full[1]!.replace(/,/g, ''));
  return null;
}

const TYPE_PATTERNS: [RegExp, PropertyType][] = [
  [re(`פנטהאוז|פנטהאוס|penthouse`), 'penthouse'],
  [re(`דופלקס|duplex`), 'duplex'],
  [re(`דירת\\s*גן|garden apartment`), 'garden_apartment'],
  [re(`דירת\\s*גג|roof apartment`), 'roof_apartment'],
  [re(`בית\\s*פרטי|קוטג'|וילה|private house`), 'private_house'],
  [re(`${notAfterWord}(?:דירה|דירת|apartment)`), 'apartment'],
];

export function findPropertyType(text: string): PropertyType | null {
  for (const [pattern, type] of TYPE_PATTERNS) if (pattern.test(text)) return type;
  return null;
}

/** true if mentioned, false if negated ("בלי/ללא/אין X"), null otherwise. */
function feature(text: string, noun: string): boolean | null {
  if (re(`(?:בלי|ללא|אין)\\s+${noun}`).test(text)) return false;
  if (re(noun).test(text)) return true;
  return null;
}

export function findFloor(text: string): number | null {
  if (re(`קומת\\s*קרקע`).test(text)) return 0;
  const m = re(`קומה\\s*(-?\\d+)`).exec(text);
  return m ? Number(m[1]) : null;
}

/** `text` should already be normalized with normalizeInputText (quotes unified). */
export function fallbackParse(text: string): IntentCandidate {
  return {
    city: findCity(text),
    propertyType: findPropertyType(text),
    rooms: findRooms(text),
    sizeSqm: findSize(text),
    floor: findFloor(text),
    hasElevator: feature(text, 'מעלית'),
    hasParking: feature(text, 'חני(?:י)?(?:ה|ות)'),
    hasSafeRoom: feature(text, `(?:ממ"?ד|מרחב מוגן)`),
    askingPriceNis: findPrice(text),
  };
}
