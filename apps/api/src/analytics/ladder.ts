import { LIMITS, type AnalysisResult, type NormalizedDeal, type PropertyQuery, type Scope } from '@fpc/shared';
import { config } from '../config.js';

const cfg = config.analytics;

type LevelSpec = { scope: Scope; neighborhood: boolean; propertyType: boolean; roomsTolerance: number | null };

/** Narrowest first. A level only filters on a field if the query has that field. */
export const LADDER: readonly LevelSpec[] = [
  { scope: 'neighborhood', neighborhood: true, propertyType: true, roomsTolerance: cfg.roomsToleranceNarrow },
  { scope: 'city_type_rooms', neighborhood: false, propertyType: true, roomsTolerance: cfg.roomsToleranceNarrow },
  { scope: 'city_rooms', neighborhood: false, propertyType: false, roomsTolerance: cfg.roomsToleranceWide },
  { scope: 'city', neighborhood: false, propertyType: false, roomsTolerance: null },
];

export type Criteria = AnalysisResult['appliedCriteria'];
export type Level = { scope: Scope; criteria: Criteria };

/** Same normalization as the CSV neighborhood: trim + collapse whitespace. */
export const neighborhoodKey = (s: string) => s.replace(/\s+/g, ' ').trim();

function criteriaFor(spec: LevelSpec, q: PropertyQuery): Criteria {
  const c: Criteria = { city: q.city };
  if (spec.neighborhood && q.neighborhood) c.neighborhood = neighborhoodKey(q.neighborhood);
  if (spec.propertyType && q.propertyType) c.propertyType = q.propertyType;
  if (spec.roomsTolerance !== null && q.rooms !== undefined) {
    c.rooms = {
      min: Math.max(LIMITS.rooms.min, q.rooms - spec.roomsTolerance),
      max: Math.min(LIMITS.rooms.max, q.rooms + spec.roomsTolerance),
    };
  }
  return c;
}

/**
 * The ladder for this query, with levels that would filter on exactly the same
 * criteria as the next (broader) level removed — e.g. without a neighborhood the
 * "neighborhood" level is the same as "city_type_rooms", so it's dropped and the
 * broader, more honest name is reported.
 */
export function levelsFor(q: PropertyQuery): Level[] {
  const all = LADDER.map((spec) => ({ scope: spec.scope, criteria: criteriaFor(spec, q) }));
  if (!q.neighborhood) all.shift(); // the neighborhood level means nothing without one
  return all.filter((lvl, i) => {
    const next = all[i + 1];
    return !next || JSON.stringify(lvl.criteria) !== JSON.stringify(next.criteria);
  });
}

export function matches(d: NormalizedDeal, c: Criteria): boolean {
  if (d.city !== c.city) return false;
  if (c.neighborhood !== undefined && d.neighborhood !== c.neighborhood) return false;
  if (c.propertyType !== undefined && d.propertyType !== c.propertyType) return false;
  if (c.rooms !== undefined && (d.rooms === null || d.rooms < c.rooms.min || d.rooms > c.rooms.max)) return false;
  return true;
}
