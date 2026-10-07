import {
  LIMITS,
  PropertyTypeSchema,
  canonicalCity,
  matchKnownNeighborhood,
  type CanonicalCity,
  type DroppedField,
  type PropertyQueryDraft,
  type QueryField,
} from '@fpc/shared';

export type KnownNeighborhoods = ReadonlyMap<CanonicalCity, ReadonlySet<string>>;

/** Candidate values from any parser (LLM or regex). Nothing here is trusted yet. */
export type IntentCandidate = Partial<Record<QueryField, unknown>>;

const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;

/**
 * The single gate between a parser and the analytics engine. Every field is
 * checked independently; anything invalid is dropped and reported, never
 * coerced into something plausible.
 */
export function validateIntent(
  c: IntentCandidate,
  ctx: { knownNeighborhoods: KnownNeighborhoods },
): { draft: PropertyQueryDraft; dropped: DroppedField[] } {
  const draft: PropertyQueryDraft = {};
  const dropped: DroppedField[] = [];
  const drop = (field: QueryField, value: unknown, reason: DroppedField['reason']) =>
    dropped.push({ field, value, reason });
  const present = (v: unknown) => v !== null && v !== undefined;

  if (present(c.city)) {
    const city = typeof c.city === 'string' ? canonicalCity(c.city) : null;
    if (city) draft.city = city;
    else drop('city', c.city, typeof c.city === 'string' ? 'unknown_city' : 'invalid_type');
  }

  if (present(c.neighborhood)) {
    const known = draft.city ? ctx.knownNeighborhoods.get(draft.city) : undefined;
    const match =
      typeof c.neighborhood === 'string' && draft.city && known
        ? matchKnownNeighborhood(draft.city, c.neighborhood, known)
        : null;
    if (match) draft.neighborhood = match;
    else
      drop(
        'neighborhood',
        c.neighborhood,
        typeof c.neighborhood === 'string' ? 'unknown_neighborhood' : 'invalid_type',
      );
  }

  if (present(c.propertyType)) {
    const t = PropertyTypeSchema.safeParse(c.propertyType);
    if (t.success) draft.propertyType = t.data;
    else drop('propertyType', c.propertyType, 'invalid_type');
  }

  const num = (
    field: 'rooms' | 'sizeSqm' | 'floor' | 'askingPriceNis',
    ok: (n: number) => boolean,
    round?: (n: number) => number,
  ) => {
    const v = c[field];
    if (!present(v)) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) return drop(field, v, 'invalid_type');
    const n = round ? round(v) : v;
    if (ok(n)) draft[field] = n;
    else drop(field, v, 'out_of_range');
  };
  num('rooms', (n) => inRange(n, LIMITS.rooms) && Number.isInteger(n / LIMITS.rooms.step));
  num('sizeSqm', (n) => inRange(n, LIMITS.sizeSqm));
  num('floor', (n) => Number.isInteger(n) && inRange(n, LIMITS.floor));
  // Shekels are whole numbers; 3,900,000.0 from a model is fine, 3.9 is not (out of range).
  num('askingPriceNis', (n) => inRange(n, LIMITS.priceNis), Math.round);

  for (const field of ['hasElevator', 'hasParking', 'hasSafeRoom'] as const) {
    const v = c[field];
    if (!present(v)) continue;
    if (typeof v === 'boolean') draft[field] = v;
    else drop(field, v, 'invalid_type');
  }

  return { draft, dropped };
}

/** (city → neighborhood names) as they appear in the normalized data. */
export function knownNeighborhoodsOf(
  deals: readonly { city: CanonicalCity; neighborhood: string | null }[],
): KnownNeighborhoods {
  const map = new Map<CanonicalCity, Set<string>>();
  for (const d of deals) {
    if (!d.neighborhood) continue;
    if (!map.has(d.city)) map.set(d.city, new Set());
    map.get(d.city)!.add(d.neighborhood);
  }
  return map;
}
