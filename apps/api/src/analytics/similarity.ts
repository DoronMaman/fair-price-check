import type { NormalizedDeal, PropertyQuery } from '@fpc/shared';
import { config } from '../config.js';
import { neighborhoodKey } from './ladder.js';

const cfg = config.analytics;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

const linear = (distance: number, span: number) => Math.max(0, 1 - distance / span);

/**
 * Similarity in [0, 1]: a weighted mean of per-feature scores, over only the
 * features the query specifies (plus recency, which always applies).
 *  - rooms: 1 at equal rooms, 0 at ±similarityRoomsSpan; unknown rooms → 0
 *  - size: 1 at equal size, 0 at ±similaritySizeSpan relative; unknown size → 0
 *  - property type / neighborhood: 1 if equal, else 0
 *  - recency: 1 today, 0 at similarityRecencyYears old
 */
export function similarity(d: NormalizedDeal, q: PropertyQuery, today: string): number {
  const w = cfg.similarityWeights;
  let total = 0;
  let weight = 0;
  const add = (wt: number, score: number) => {
    total += wt * score;
    weight += wt;
  };

  if (q.rooms !== undefined)
    add(w.rooms, d.rooms === null ? 0 : linear(Math.abs(d.rooms - q.rooms), cfg.similarityRoomsSpan));
  if (q.sizeSqm !== undefined) {
    add(w.size, d.sizeSqm === null ? 0 : linear(Math.abs(d.sizeSqm - q.sizeSqm) / q.sizeSqm, cfg.similaritySizeSpan));
  }
  if (q.propertyType !== undefined) add(w.propertyType, d.propertyType === q.propertyType ? 1 : 0);
  if (q.neighborhood !== undefined) add(w.neighborhood, d.neighborhood === neighborhoodKey(q.neighborhood) ? 1 : 0);
  const ageYears = (Date.parse(today) - Date.parse(d.dealDate)) / MS_PER_YEAR;
  add(w.recency, linear(Math.max(0, ageYears), cfg.similarityRecencyYears));

  return total / weight;
}

/** Most similar first; ties → more recent, then deal id, so the order is deterministic. */
export function rankBySimilarity(deals: NormalizedDeal[], q: PropertyQuery, today: string) {
  return deals
    .map((deal) => ({ deal, similarity: similarity(deal, q, today) }))
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.deal.dealDate.localeCompare(a.deal.dealDate) ||
        a.deal.dealId.localeCompare(b.deal.dealId),
    );
}
