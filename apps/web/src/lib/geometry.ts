import { CANONICAL_CITIES, CITY_ALIASES, cityKey, type CanonicalCity } from '@fpc/shared';

export type RangeLayout = {
  /** Percent positions from the inline-start edge (right in RTL). */
  band: { start: number; width: number };
  median: number;
  asking: number | null;
};

/**
 * Positions for the range bar. The domain pads the band (and the asking price,
 * if outside it) so markers never sit on the edge. Low prices at inline-start.
 */
export function rangeLayout(est: { low: number; median: number; high: number }, asking?: number): RangeLayout {
  const lo = Math.min(est.low, asking ?? est.low);
  const hi = Math.max(est.high, asking ?? est.high);
  const pad = Math.max((hi - lo) * 0.15, est.median * 0.02);
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  return {
    band: { start: pos(est.low), width: pos(est.high) - pos(est.low) },
    median: pos(est.median),
    asking: asking === undefined ? null : pos(asking),
  };
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * Canonical cities spelled closest to what the user wrote (by edit distance over
 * names and aliases). Only close matches — for a city simply not in the data
 * (e.g. "אילת") this returns nothing rather than a misleading guess.
 */
export function closestCities(raw: string, limit = 3): CanonicalCity[] {
  const key = cityKey(raw);
  if (!key) return [];
  const candidates: [string, CanonicalCity][] = [
    ...CANONICAL_CITIES.map((c) => [c, c] as [string, CanonicalCity]),
    ...Object.entries(CITY_ALIASES),
  ];
  const best = new Map<CanonicalCity, number>();
  for (const [name, city] of candidates) {
    const d = levenshtein(key, cityKey(name));
    const allowed = Math.max(1, Math.floor(cityKey(name).length * 0.34));
    if (d <= allowed && d < (best.get(city) ?? Infinity)) best.set(city, d);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([c]) => c);
}
