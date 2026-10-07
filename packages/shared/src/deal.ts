import { z } from 'zod';
import { CanonicalCitySchema } from './cityAliases.js';
import { ConditionSchema, PropertyTypeSchema, SourceSchema } from './enums.js';

const TriState = z.boolean().nullable(); // null = unknown, never "no"

export const DatePrecisionSchema = z.enum(['day', 'month']);
export type DatePrecision = z.infer<typeof DatePrecisionSchema>;

export const NormalizedDealSchema = z.object({
  dealId: z.string(),
  city: CanonicalCitySchema,
  /** Trimmed; identity is always (city, neighborhood) — "מרכז" exists in many cities. */
  neighborhood: z.string().nullable(),
  propertyType: PropertyTypeSchema,
  rooms: z.number().nullable(),
  sizeSqm: z.number().nullable(),
  floor: z.number().int().nullable(),
  totalFloors: z.number().int().nullable(),
  yearBuilt: z.number().int().nullable(),
  /** Kept for display only; never used for matching (contradicts year_built in 85 rows). */
  condition: ConditionSchema.nullable(),
  hasElevator: TriState,
  hasParking: TriState,
  hasBalcony: TriState,
  hasSafeRoom: TriState,
  /** ISO YYYY-MM-DD. For month precision this is the 1st of the month. */
  dealDate: z.iso.date(),
  datePrecision: DatePrecisionSchema,
  priceNis: z.number().int().positive(),
  /** Recomputed from price / size. The CSV column is ignored. Null when size is unknown. */
  pricePerSqm: z.number().nullable(),
  source: SourceSchema,
  /** High-end outlier within its city (IQR rule). Kept in the data, excluded from stats. */
  isOutlier: z.boolean(),
});
export type NormalizedDeal = z.infer<typeof NormalizedDealSchema>;

export const REJECT_REASONS = [
  'missing_deal_id',
  'unknown_city',
  'unknown_property_type',
  'unknown_source',
  'price_unparseable',
  'price_below_min',
  'date_unparseable',
  'date_in_future',
] as const;
export const RejectReasonSchema = z.enum(REJECT_REASONS);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

const Counts = z.record(z.string(), z.number().int());

export const DataQualityReportSchema = z.object({
  dataVersion: z.string(),
  rawRows: z.number().int(),
  validDeals: z.number().int(),
  /** Field-level counts are over all raw rows, before dedup, so they match a manual audit of the file. */
  fieldIssues: z.object({
    city: z.object({
      rawSpellings: z.number().int(),
      canonicalCities: z.number().int(),
      /** raw spelling → canonical, only where they differ. */
      aliasesResolved: z.record(z.string(), z.string()),
    }),
    neighborhood: z.object({
      missing: z.number().int(),
      whitespaceFixed: z.number().int(),
      /** "city / raw spelling" → canonical neighborhood. */
      aliasesResolved: z.record(z.string(), z.string()),
    }),
    propertyType: z.object({ whitespaceFixed: z.number().int() }),
    condition: z.object({
      missing: z.number().int(),
      whitespaceFixed: z.number().int(),
      newFromContractorBuiltBefore2015: z.number().int(),
    }),
    rooms: z.object({ withHebrewSuffix: z.number().int(), invalidSetNull: z.number().int() }),
    price: z.object({ withCommas: z.number().int(), withShekelSign: z.number().int() }),
    sizeSqm: z.object({ missing: z.number().int(), outOfRangeSetNull: z.number().int() }),
    pricePerSqmColumn: z.object({
      ignored: z.literal(true),
      missing: z.number().int(),
      zero: z.number().int(),
      inconsistentWithPriceAndSize: z.number().int(),
    }),
    booleans: z.object({
      spellings: z.array(z.string()),
      unknownByField: Counts,
    }),
    dealDate: z.object({ byFormat: Counts, ambiguousDayMonth: z.number().int() }),
    yearBuilt: z.object({ missing: z.number().int() }),
    floor: z.object({ missing: z.number().int() }),
  }),
  duplicates: z.object({
    exactDropped: z.number().int(),
    conflicts: z.array(
      z.object({
        dealId: z.string(),
        kept: z.object({ source: SourceSchema, priceNis: z.number() }),
        dropped: z.array(z.object({ source: SourceSchema, priceNis: z.number() })),
      }),
    ),
  }),
  rejected: z.array(z.object({ dealId: z.string(), reason: RejectReasonSchema, rawValue: z.string() })),
  outliers: z.array(
    z.object({
      dealId: z.string(),
      city: CanonicalCitySchema,
      priceNis: z.number(),
      pricePerSqm: z.number().nullable(),
      flaggedOn: z.array(z.enum(['price', 'pricePerSqm'])),
    }),
  ),
});
export type DataQualityReport = z.infer<typeof DataQualityReportSchema>;
