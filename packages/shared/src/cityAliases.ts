import { z } from 'zod';

// One canonical name per city: the official Hebrew name.
// This list is the only set of cities the app (and the LLM) may name.
export const CANONICAL_CITIES = [
  'תל אביב-יפו',
  'ירושלים',
  'חיפה',
  'באר שבע',
  'בית שמש',
  'מודיעין-מכבים-רעות',
  'ראשון לציון',
  'פתח תקווה',
  'חולון',
  'בת ים',
  'רמת גן',
  'גבעתיים',
  'נתניה',
  'כפר סבא',
  'רעננה',
  'הרצליה',
  'רחובות',
  'אשדוד',
] as const;
export const CanonicalCitySchema = z.enum(CANONICAL_CITIES);
export type CanonicalCity = z.infer<typeof CanonicalCitySchema>;

/**
 * Every alias maps to exactly one canonical city. Matching is exact on the
 * normalized key (see cityKey) — no fuzzy matching, so an unknown or similar-
 * looking name (e.g. "מודיעין עילית", a different city) resolves to null, not a guess.
 * The first group is every raw spelling found in the CSV; the rest are common
 * user/LLM spellings.
 */
export const CITY_ALIASES: Record<string, CanonicalCity> = {
  // Seen in the CSV
  'ת"א': 'תל אביב-יפו',
  'תל אביב': 'תל אביב-יפו',
  'תל אביב יפו': 'תל אביב-יפו',
  'Tel Aviv-Yafo': 'תל אביב-יפו',
  'ב"ש': 'באר שבע',
  'באר-שבע': 'באר שבע',
  Jerusalem: 'ירושלים',
  'בית-שמש': 'בית שמש',
  מודיעין: 'מודיעין-מכבים-רעות',
  'מודיעין מכבים רעות': 'מודיעין-מכבים-רעות',

  // Common user / LLM spellings
  'תל-אביב': 'תל אביב-יפו',
  'ת"א-יפו': 'תל אביב-יפו',
  'Tel Aviv': 'תל אביב-יפו',
  TLV: 'תל אביב-יפו',
  'י-ם': 'ירושלים',
  'Beer Sheva': 'באר שבע',
  "Be'er Sheva": 'באר שבע',
  Beersheba: 'באר שבע',
  'Beit Shemesh': 'בית שמש',
  "Modi'in": 'מודיעין-מכבים-רעות',
  Modiin: 'מודיעין-מכבים-רעות',
  'ראשל"צ': 'ראשון לציון',
  'Rishon LeZion': 'ראשון לציון',
  'פ"ת': 'פתח תקווה',
  'פתח תקוה': 'פתח תקווה',
  'Petah Tikva': 'פתח תקווה',
  Holon: 'חולון',
  'Bat Yam': 'בת ים',
  'ר"ג': 'רמת גן',
  'רמת-גן': 'רמת גן',
  'Ramat Gan': 'רמת גן',
  Givatayim: 'גבעתיים',
  Netanya: 'נתניה',
  'כ"ס': 'כפר סבא',
  'Kfar Saba': 'כפר סבא',
  "Ra'anana": 'רעננה',
  Raanana: 'רעננה',
  Herzliya: 'הרצליה',
  Rehovot: 'רחובות',
  Ashdod: 'אשדוד',
  Haifa: 'חיפה',
};

/**
 * Normalization key for city lookup: Unicode NFC, Hebrew gershayim/geresh and
 * curly quotes unified to ASCII, hyphens/dashes treated as spaces, whitespace
 * collapsed, Latin lowercased.
 */
export function cityKey(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/[-‐-―־_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const KEY_TO_CITY: ReadonlyMap<string, CanonicalCity> = (() => {
  const map = new Map<string, CanonicalCity>();
  const add = (alias: string, city: CanonicalCity) => {
    const key = cityKey(alias);
    const existing = map.get(key);
    if (existing && existing !== city) {
      throw new Error(`City alias "${alias}" maps to both ${existing} and ${city}`);
    }
    map.set(key, city);
  };
  for (const city of CANONICAL_CITIES) add(city, city);
  for (const [alias, city] of Object.entries(CITY_ALIASES)) add(alias, city);
  return map;
})();

/** Resolve any spelling to its canonical city, or null if it isn't a known alias. */
export function canonicalCity(raw: string | null | undefined): CanonicalCity | null {
  if (raw == null) return null;
  return KEY_TO_CITY.get(cityKey(raw)) ?? null;
}
