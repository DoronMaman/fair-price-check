// DataQualityReport field counts, tallied over every raw row (before dedup) so the
// numbers match a manual audit of the file. Uses the same parsers as normalizeRow.
import { CONDITION_LABELS_HE, canonicalCity, resolveNeighborhoodAlias, type DataQualityReport } from '@fpc/shared';
import { config } from '../config.js';
import {
  cleanText,
  parseDealDate,
  parseIntOrNull,
  parsePrice,
  parseRooms,
  parseSizeSqm,
  parseTriState,
  type RawRow,
} from './parsers.js';

const cfg = config.data;

export type FieldIssues = DataQualityReport['fieldIssues'];

export function emptyFieldIssues(): FieldIssues {
  return {
    city: { rawSpellings: 0, canonicalCities: 0, aliasesResolved: {} },
    neighborhood: { missing: 0, whitespaceFixed: 0, aliasesResolved: {} },
    propertyType: { whitespaceFixed: 0 },
    condition: { missing: 0, whitespaceFixed: 0, newFromContractorBuiltBefore2015: 0 },
    rooms: { withHebrewSuffix: 0, invalidSetNull: 0 },
    price: { withCommas: 0, withShekelSign: 0 },
    sizeSqm: { missing: 0, outOfRangeSetNull: 0 },
    pricePerSqmColumn: { ignored: true, missing: 0, zero: 0, inconsistentWithPriceAndSize: 0 },
    booleans: {
      spellings: [],
      unknownByField: { has_elevator: 0, has_parking: 0, has_balcony: 0, has_safe_room: 0 },
    },
    dealDate: { byFormat: { iso: 0, dot: 0, slash: 0, monthYear: 0, unparseable: 0 }, ambiguousDayMonth: 0 },
    yearBuilt: { missing: 0 },
    floor: { missing: 0 },
  };
}

const inc = (rec: Record<string, number>, key: string) => {
  rec[key] = (rec[key] ?? 0) + 1;
};

export function tallyFieldIssues(r: RawRow, f: FieldIssues, rawCities: Set<string>, boolSpellings: Set<string>) {
  rawCities.add(r.city);

  const nb = cleanText(r.neighborhood);
  if (nb === null) f.neighborhood.missing++;
  else if (nb !== r.neighborhood) f.neighborhood.whitespaceFixed++;
  const city = canonicalCity(r.city);
  if (nb !== null && city) {
    const resolved = resolveNeighborhoodAlias(city, nb);
    if (resolved !== nb) f.neighborhood.aliasesResolved[`${city} / ${nb}`] = resolved;
  }

  if (cleanText(r.property_type) !== r.property_type) f.propertyType.whitespaceFixed++;

  const cond = cleanText(r.condition);
  if (cond === null) f.condition.missing++;
  else if (cond !== r.condition) f.condition.whitespaceFixed++;
  const year = parseIntOrNull(r.year_built);
  if (cond === CONDITION_LABELS_HE.new_from_contractor && year !== null && year < cfg.newConditionYearCutoff) {
    f.condition.newFromContractorBuiltBefore2015++;
  }
  if (year === null) f.yearBuilt.missing++;

  const rooms = parseRooms(r.rooms);
  if (rooms.hadSuffix) f.rooms.withHebrewSuffix++;
  if (rooms.invalid) f.rooms.invalidSetNull++;

  const price = parsePrice(r.price_nis);
  if (price.hadCommas) f.price.withCommas++;
  if (price.hadShekel) f.price.withShekelSign++;

  const size = parseSizeSqm(r.size_sqm);
  if (r.size_sqm.trim() === '') f.sizeSqm.missing++;
  if (size.outOfRange) f.sizeSqm.outOfRangeSetNull++;

  const stated = parsePrice(r.price_per_sqm).value;
  if (r.price_per_sqm.trim() === '') f.pricePerSqmColumn.missing++;
  else if (stated === 0) f.pricePerSqmColumn.zero++;
  else if (stated !== null && price.value && size.value) {
    const actual = price.value / size.value;
    if (Math.abs(stated - actual) / actual > cfg.pricePerSqmTolerance) {
      f.pricePerSqmColumn.inconsistentWithPriceAndSize++;
    }
  }

  for (const field of ['has_elevator', 'has_parking', 'has_balcony', 'has_safe_room'] as const) {
    const raw = r[field].trim();
    if (raw !== '') boolSpellings.add(raw);
    if (parseTriState(raw) === null) inc(f.booleans.unknownByField, field);
  }

  // Format detection only (no future-date check here — that's a rejection, reported separately).
  const parsed = parseDealDate(r.deal_date, '9999-12-31');
  if (parsed.ok) {
    inc(f.dealDate.byFormat, parsed.value.format);
    if (parsed.value.ambiguous) f.dealDate.ambiguousDayMonth++;
  } else {
    inc(f.dealDate.byFormat, 'unparseable');
  }

  if (r.floor.trim() === '') f.floor.missing++;
}
