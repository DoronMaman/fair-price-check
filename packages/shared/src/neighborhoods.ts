import { cityKey, type CanonicalCity } from './cityAliases.js';

/**
 * Neighborhood spellings that refer to the same place, per city. Only merges
 * that are certain from the names themselves; "מרכז" vs "מרכז העיר" are NOT
 * merged because nothing in the data says they're the same area.
 */
export const NEIGHBORHOOD_ALIASES: Partial<Record<CanonicalCity, Record<string, string>>> = {
  'בית שמש': {
    'רמת בית שמש א': "רמת בית שמש א'",
    'רמב"ש א\'': "רמת בית שמש א'",
    'רמב"ש א': "רמת בית שמש א'",
    'רמת בית שמש ג': "רמת בית שמש ג'",
    'רמב"ש ג\'': "רמת בית שמש ג'",
    'רמב"ש ג': "רמת בית שמש ג'",
  },
  'תל אביב-יפו': {
    Florentin: 'פלורנטין',
  },
};

/** Same normalization as city lookup: quotes unified, hyphens as spaces, whitespace collapsed. */
export const neighborhoodKey = cityKey;

/** Applies the alias table; returns the input (whitespace-cleaned) when there's no alias. */
export function resolveNeighborhoodAlias(city: CanonicalCity, name: string): string {
  const aliases = NEIGHBORHOOD_ALIASES[city];
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!aliases) return cleaned;
  const key = neighborhoodKey(cleaned);
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (neighborhoodKey(alias) === key) return canonical;
  }
  return cleaned;
}

/**
 * Resolves free text (from the LLM or the user) to a neighborhood that exists
 * in the data for this city, or null. Tolerates quote style, hyphens, case and a
 * leading "שכונת"/"שכונה", but never guesses beyond that.
 */
export function matchKnownNeighborhood(city: CanonicalCity, raw: string, known: ReadonlySet<string>): string | null {
  const candidates = [raw, raw.replace(/^\s*שכונ(?:ת|ה)\s+/, '')];
  for (const cand of candidates) {
    const resolved = resolveNeighborhoodAlias(city, cand);
    const key = neighborhoodKey(resolved);
    for (const k of known) if (neighborhoodKey(k) === key) return k;
  }
  return null;
}
