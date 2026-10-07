import type {
  AnalysisResult,
  Basis,
  Comparable,
  Confidence,
  NormalizedDeal,
  PriceStats,
  PropertyQuery,
  Scope,
  Verdict,
} from '@fpc/shared';
import { config } from '../config.js';
import { quantile, sortedAsc } from '../lib/stats.js';
import { buildFactSheet, roundTo } from './factSheet.js';
import { levelsFor, matches, type Level } from './ladder.js';
import { rankBySimilarity } from './similarity.js';

const cfg = config.analytics;

/**
 * Deals that contribute to the stats: not outliers, and with a value for the basis.
 * Note the asking price is never a filter — it is only compared afterwards.
 */
function usable(deals: NormalizedDeal[], basis: Basis): NormalizedDeal[] {
  return deals.filter((d) => !d.isOutlier && (basis === 'price' || d.pricePerSqm !== null));
}

const basisValue = (d: NormalizedDeal, basis: Basis) => (basis === 'price' ? d.priceNis : d.pricePerSqm!);

export function computeStats(deals: NormalizedDeal[], basis: Basis): PriceStats | null {
  if (deals.length === 0) return null;
  const v = sortedAsc(deals.map((d) => basisValue(d, basis)));
  const dates = deals.map((d) => d.dealDate).sort();
  return {
    n: v.length,
    median: quantile(v, 0.5),
    p25: quantile(v, 0.25),
    p75: quantile(v, 0.75),
    min: v[0]!,
    max: v[v.length - 1]!,
    dateFrom: dates[0]!,
    dateTo: dates[dates.length - 1]!,
  };
}

export function confidenceFor(n: number, scope: Scope, basis: Basis): Confidence {
  if (n < cfg.insufficientBelow) return 'INSUFFICIENT';
  if (n < cfg.minComps) return 'LOW';
  const typeLevel = scope === 'neighborhood' || scope === 'city_type_rooms';
  // Without a size we compare total prices, which mix small and large units — never HIGH.
  if (typeLevel && n >= cfg.highConfidenceMinComps && basis === 'pricePerSqm') return 'HIGH';
  return scope === 'city' ? 'LOW' : 'MEDIUM';
}

export function verdictFor(asking: number, est: { low: number; median: number; high: number }) {
  const verdict: Verdict = asking < est.low ? 'below_range' : asking > est.high ? 'above_range' : 'within_range';
  return { verdict, askingVsMedian: asking / est.median - 1 };
}

function toComparable(deal: NormalizedDeal, similarity: number): Comparable {
  return {
    dealId: deal.dealId,
    dealDate: deal.dealDate,
    datePrecision: deal.datePrecision,
    source: deal.source,
    city: deal.city,
    neighborhood: deal.neighborhood,
    propertyType: deal.propertyType,
    rooms: deal.rooms,
    sizeSqm: deal.sizeSqm,
    priceNis: deal.priceNis,
    pricePerSqm: deal.pricePerSqm,
    similarity,
  };
}

/** Walk the ladder; stop at the first level with ≥ minComps usable deals, else the broadest. */
export function chooseLevel(q: PropertyQuery, deals: NormalizedDeal[], basis: Basis) {
  const levels = levelsFor(q);
  let chosen: { level: Level; matched: NormalizedDeal[] } | null = null;
  // Every level filters within one city, so narrow to it once instead of per level.
  const cityDeals = deals.filter((d) => d.city === q.city);
  for (const level of levels) {
    const matched = cityDeals.filter((d) => matches(d, level.criteria));
    chosen = { level, matched };
    if (usable(matched, basis).length >= cfg.minComps) break;
  }
  return chosen!; // levels always ends with the city level
}

/** Pure and deterministic: same query + deals + today → same result. No LLM. */
export function analyze(
  query: PropertyQuery,
  dataset: {
    deals: NormalizedDeal[];
    dataVersion: string;
    /** Optional index built at boot; avoids scanning every deal per request as the data grows. */
    byCity?: ReadonlyMap<string, NormalizedDeal[]>;
  },
  opts: { today: string },
): AnalysisResult {
  const basis: Basis = query.sizeSqm !== undefined ? 'pricePerSqm' : 'price';
  const { level, matched } = chooseLevel(query, dataset.byCity?.get(query.city) ?? dataset.deals, basis);
  const comps = usable(matched, basis);
  const nComps = comps.length;
  const confidence = confidenceFor(nComps, level.scope, basis);
  const insufficient = confidence === 'INSUFFICIENT';

  const stats = insufficient ? null : computeStats(comps, basis);
  // Rounded before the verdict, so the verdict always agrees with the range the user sees.
  const round = (n: number) => roundTo(n, cfg.roundEstimateNis);
  const scale = basis === 'pricePerSqm' ? query.sizeSqm! : 1;
  const estimate =
    stats === null
      ? null
      : { low: round(stats.p25 * scale), median: round(stats.median * scale), high: round(stats.p75 * scale) };
  const verdict = estimate && query.askingPriceNis !== undefined ? verdictFor(query.askingPriceNis, estimate) : null;

  const comparables = rankBySimilarity(comps, query, opts.today)
    .slice(0, cfg.topComparables)
    .map((r) => toComparable(r.deal, r.similarity));
  const excludedOutliers = rankBySimilarity(
    matched.filter((d) => d.isOutlier),
    query,
    opts.today,
  ).map((r) => toComparable(r.deal, r.similarity));

  const partial = {
    dataVersion: dataset.dataVersion,
    query,
    scope: level.scope,
    appliedCriteria: level.criteria,
    basis,
    confidence,
    nComps,
    stats,
    estimate,
    verdict,
    comparables,
    excludedOutliers,
  };
  return { ...partial, facts: buildFactSheet(partial) };
}
