// Row → deal, and the dataset-level steps (exact dedup, rejections, source-precedence
// conflict resolution, per-city outliers) that produce NormalizedDeal[] + the report.
import {
  CANONICAL_CITIES,
  CONDITION_LABELS_HE,
  PROPERTY_TYPE_LABELS_HE,
  SOURCE_LABELS_HE,
  canonicalCity,
  fromHebrewLabel,
  type CanonicalCity,
  type DataQualityReport,
  type NormalizedDeal,
  type RejectReason,
} from '@fpc/shared';
import { config } from '../config.js';
import { quantile, sortedAsc } from '../lib/stats.js';
import {
  RawRowSchema,
  cleanText,
  neighborhoodOf,
  parseDealDate,
  parseIntOrNull,
  parsePrice,
  parseRooms,
  parseSizeSqm,
  parseTriState,
  parseYearBuilt,
  recomputePricePerSqm,
  sourceRank,
  type RawRow,
} from './parsers.js';
import { emptyFieldIssues, tallyFieldIssues } from './qualityReport.js';

const cfg = config.data;

// ---------------------------------------------------------------------------
// Row → deal
// ---------------------------------------------------------------------------

type DealWithoutFlags = Omit<NormalizedDeal, 'isOutlier'>;
type RowResult = { ok: true; deal: DealWithoutFlags } | { ok: false; reason: RejectReason; rawValue: string };

export function normalizeRow(raw: RawRow, today: string): RowResult {
  const reject = (reason: RejectReason, rawValue: string): RowResult => ({ ok: false, reason, rawValue });

  const dealId = raw.deal_id.trim();
  if (!dealId) return reject('missing_deal_id', raw.deal_id);

  const city = canonicalCity(raw.city);
  if (!city) return reject('unknown_city', raw.city);

  const propertyTypeText = cleanText(raw.property_type);
  const propertyType = propertyTypeText ? fromHebrewLabel(PROPERTY_TYPE_LABELS_HE, propertyTypeText) : null;
  if (!propertyType) return reject('unknown_property_type', raw.property_type);

  const sourceText = cleanText(raw.source);
  const source = sourceText ? fromHebrewLabel(SOURCE_LABELS_HE, sourceText) : null;
  if (!source) return reject('unknown_source', raw.source);

  const price = parsePrice(raw.price_nis).value;
  if (price === null) return reject('price_unparseable', raw.price_nis);
  if (price < cfg.minValidPriceNis) return reject('price_below_min', raw.price_nis);

  const date = parseDealDate(raw.deal_date, today);
  if (!date.ok) return reject(date.reason, raw.deal_date);

  const conditionText = cleanText(raw.condition);
  const sizeSqm = parseSizeSqm(raw.size_sqm).value;

  return {
    ok: true,
    deal: {
      dealId,
      city,
      neighborhood: neighborhoodOf(city, raw.neighborhood),
      propertyType,
      rooms: parseRooms(raw.rooms).value,
      sizeSqm,
      floor: parseIntOrNull(raw.floor),
      totalFloors: parseIntOrNull(raw.total_floors),
      yearBuilt: parseYearBuilt(raw.year_built, today),
      condition: conditionText ? fromHebrewLabel(CONDITION_LABELS_HE, conditionText) : null,
      hasElevator: parseTriState(raw.has_elevator),
      hasParking: parseTriState(raw.has_parking),
      hasBalcony: parseTriState(raw.has_balcony),
      hasSafeRoom: parseTriState(raw.has_safe_room),
      dealDate: date.value.date,
      datePrecision: date.value.precision,
      priceNis: price,
      pricePerSqm: recomputePricePerSqm(price, sizeSqm),
      source,
    },
  };
}

// ---------------------------------------------------------------------------
// Dataset-level steps
// ---------------------------------------------------------------------------

/** Keep the most trusted source per deal_id; ties keep the first row seen. */
export function resolveConflicts(deals: DealWithoutFlags[]): {
  deals: DealWithoutFlags[];
  conflicts: DataQualityReport['duplicates']['conflicts'];
} {
  const groups = new Map<string, DealWithoutFlags[]>();
  for (const d of deals) groups.set(d.dealId, [...(groups.get(d.dealId) ?? []), d]);

  const kept: DealWithoutFlags[] = [];
  const conflicts: DataQualityReport['duplicates']['conflicts'] = [];
  for (const [dealId, group] of groups) {
    const ranked = [...group].sort((a, b) => sourceRank(a.source) - sourceRank(b.source)); // stable
    const winner = ranked[0]!;
    kept.push(winner);
    if (group.length > 1) {
      conflicts.push({
        dealId,
        kept: { source: winner.source, priceNis: winner.priceNis },
        dropped: ranked.slice(1).map((d) => ({ source: d.source, priceNis: d.priceNis })),
      });
    }
  }
  return { deals: kept, conflicts };
}

function upperFence(values: number[]): number {
  const s = sortedAsc(values);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return q3 + cfg.outlierIqrMultiplier * (q3 - q1);
}

/** Per-city high-end outliers on price and on ₪/m². Returns dealId → what was flagged. */
export function findOutliers(deals: DealWithoutFlags[]): Map<string, ('price' | 'pricePerSqm')[]> {
  const byCity = new Map<CanonicalCity, DealWithoutFlags[]>();
  for (const d of deals) byCity.set(d.city, [...(byCity.get(d.city) ?? []), d]);

  const flags = new Map<string, ('price' | 'pricePerSqm')[]>();
  const flag = (id: string, on: 'price' | 'pricePerSqm') => flags.set(id, [...(flags.get(id) ?? []), on]);

  for (const cityDeals of byCity.values()) {
    if (cityDeals.length >= cfg.minCityRowsForOutliers) {
      const fence = upperFence(cityDeals.map((d) => d.priceNis));
      for (const d of cityDeals) if (d.priceNis > fence) flag(d.dealId, 'price');
    }
    const withSize = cityDeals.filter((d) => d.pricePerSqm !== null);
    if (withSize.length >= cfg.minCityRowsForOutliers) {
      const fence = upperFence(withSize.map((d) => d.pricePerSqm!));
      for (const d of withSize) if (d.pricePerSqm! > fence) flag(d.dealId, 'pricePerSqm');
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// normalizeDataset
// ---------------------------------------------------------------------------

export function normalizeDataset(
  rawRows: unknown[],
  opts: { today: string; dataVersion: string },
): { deals: NormalizedDeal[]; report: DataQualityReport } {
  const rows = rawRows.map((r, i) => {
    const parsed = RawRowSchema.safeParse(r);
    if (!parsed.success) throw new Error(`CSV row ${i + 2} has an unexpected shape: ${parsed.error.message}`);
    return parsed.data;
  });

  // Field-level counts over every raw row (before dedup), to match a manual audit of the file.
  const f = emptyFieldIssues();
  const rawCities = new Set<string>();
  const boolSpellings = new Set<string>();
  for (const r of rows) tallyFieldIssues(r, f, rawCities, boolSpellings);

  // Exact duplicates: identical raw rows.
  const seen = new Set<string>();
  let exactDropped = 0;
  const candidates: DealWithoutFlags[] = [];
  const rejected: DataQualityReport['rejected'] = [];
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seen.has(key)) {
      exactDropped++;
      continue;
    }
    seen.add(key);
    const res = normalizeRow(r, opts.today);
    if (res.ok) candidates.push(res.deal);
    else rejected.push({ dealId: r.deal_id, reason: res.reason, rawValue: res.rawValue });
  }

  const { deals: unique, conflicts } = resolveConflicts(candidates);
  const outlierFlags = findOutliers(unique);
  const deals: NormalizedDeal[] = unique.map((d) => ({ ...d, isOutlier: outlierFlags.has(d.dealId) }));

  const aliasesResolved: Record<string, string> = {};
  for (const raw of rawCities) {
    const c = canonicalCity(raw);
    if (c && c !== raw) aliasesResolved[raw] = c;
  }
  const citiesInData = new Set(deals.map((d) => d.city));

  const report: DataQualityReport = {
    dataVersion: opts.dataVersion,
    rawRows: rows.length,
    validDeals: deals.length,
    fieldIssues: {
      ...f,
      city: {
        rawSpellings: rawCities.size,
        canonicalCities: CANONICAL_CITIES.filter((c) => citiesInData.has(c)).length,
        aliasesResolved,
      },
      booleans: { ...f.booleans, spellings: [...boolSpellings].sort() },
    },
    duplicates: { exactDropped, conflicts },
    rejected,
    outliers: deals
      .filter((d) => d.isOutlier)
      .map((d) => ({
        dealId: d.dealId,
        city: d.city,
        priceNis: d.priceNis,
        pricePerSqm: d.pricePerSqm,
        flaggedOn: outlierFlags.get(d.dealId)!,
      })),
  };
  return { deals, report };
}
