import { z } from 'zod';
import { CanonicalCitySchema } from './cityAliases.js';
import { DatePrecisionSchema } from './deal.js';
import { PropertyTypeSchema, SourceSchema } from './enums.js';
import { PropertyQuerySchema } from './query.js';

/** Widening ladder, narrowest first. */
export const SCOPES = ['neighborhood', 'city_type_rooms', 'city_rooms', 'city'] as const;
export const ScopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof ScopeSchema>;

export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const;
export const ConfidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const VERDICTS = ['below_range', 'within_range', 'above_range'] as const;
export const VerdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * What the comparison is based on. ₪/m² when the query has a size (fairer across
 * different sizes); total price otherwise, which includes deals without a size.
 */
export const BasisSchema = z.enum(['pricePerSqm', 'price']);
export type Basis = z.infer<typeof BasisSchema>;

/** Every fact the explanation may reference, as {{fact_id}}. */
export const FACT_IDS = [
  'city',
  'scope_label',
  'n_comps',
  'n_outliers_excluded',
  'date_from',
  'date_to',
  'date_range_years',
  'median_ppsqm',
  'p25_ppsqm',
  'p75_ppsqm',
  'size_sqm',
  'estimate_low',
  'estimate_median',
  'estimate_high',
  'asking_price',
  'asking_vs_median_pct',
] as const;
export const FactIdSchema = z.enum(FACT_IDS);
export type FactId = z.infer<typeof FactIdSchema>;

export const FactSchema = z.object({
  value: z.union([z.number(), z.string()]),
  /** Display string produced by code (Intl he-IL). The only form the user ever sees. */
  formatted: z.string(),
  /** Hebrew description of what the fact means — this, not the value, is shown to the LLM. */
  description: z.string(),
});
export type Fact = z.infer<typeof FactSchema>;

/** Only facts that exist for this analysis are present. */
export const FactSheetSchema = z.partialRecord(FactIdSchema, FactSchema);
export type FactSheet = z.infer<typeof FactSheetSchema>;

export const ComparableSchema = z.object({
  dealId: z.string(),
  dealDate: z.iso.date(),
  datePrecision: DatePrecisionSchema,
  source: SourceSchema,
  city: CanonicalCitySchema,
  neighborhood: z.string().nullable(),
  propertyType: PropertyTypeSchema,
  rooms: z.number().nullable(),
  sizeSqm: z.number().nullable(),
  priceNis: z.number(),
  pricePerSqm: z.number().nullable(),
  /** 0–1, see similarity.ts for the weights. */
  similarity: z.number(),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const PriceStatsSchema = z.object({
  n: z.number().int(),
  median: z.number(),
  p25: z.number(),
  p75: z.number(),
  min: z.number(),
  max: z.number(),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
});
export type PriceStats = z.infer<typeof PriceStatsSchema>;

export const AnalysisResultSchema = z.object({
  dataVersion: z.string(),
  query: PropertyQuerySchema,
  scope: ScopeSchema,
  /** The filters actually applied at this scope (a level only filters on fields the query has). */
  appliedCriteria: z.object({
    city: CanonicalCitySchema,
    neighborhood: z.string().optional(),
    propertyType: PropertyTypeSchema.optional(),
    rooms: z.object({ min: z.number(), max: z.number() }).optional(),
  }),
  basis: BasisSchema,
  confidence: ConfidenceSchema,
  /** Comparable deals used for stats (outliers excluded). */
  nComps: z.number().int(),
  /** Null when confidence is INSUFFICIENT — no numbers are claimed then. */
  stats: PriceStatsSchema.nullable(),
  /** Price range for the queried property in ₪, rounded for display (config). Null when INSUFFICIENT. */
  estimate: z.object({ low: z.number(), median: z.number(), high: z.number() }).nullable(),
  /** Null without an asking price, or when INSUFFICIENT. */
  verdict: z
    .object({
      verdict: VerdictSchema,
      /** Signed: +0.12 means asking is 12% above the median estimate. */
      askingVsMedian: z.number(),
    })
    .nullable(),
  comparables: z.array(ComparableSchema),
  /** Deals at this scope that were flagged as outliers and left out of the stats. */
  excludedOutliers: z.array(ComparableSchema),
  facts: FactSheetSchema,
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
