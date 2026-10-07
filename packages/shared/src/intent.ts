import { z } from 'zod';
import { PropertyQuerySchema } from './query.js';

/**
 * What the parser understood. Every field is optional — city included, since the
 * user may not have named one (or named one we have no data for). The UI shows
 * this as editable chips; the analysis only runs once city is present.
 */
export const PropertyQueryDraftSchema = PropertyQuerySchema.partial();
export type PropertyQueryDraft = z.infer<typeof PropertyQueryDraftSchema>;

/**
 * Every query field, derived from the schema itself — so adding a field to
 * PropertyQuerySchema can't silently leave it out of cache keys, chips or evals.
 */
export const QUERY_FIELDS = PropertyQuerySchema.keyof().options;
export type QueryField = (typeof QUERY_FIELDS)[number];

export const DROP_REASONS = ['invalid_type', 'unknown_city', 'unknown_neighborhood', 'out_of_range'] as const;

/** A value the parser produced that code refused to trust. */
export const DroppedFieldSchema = z.object({
  field: z.enum(QUERY_FIELDS),
  value: z.unknown(),
  reason: z.enum(DROP_REASONS),
});
export type DroppedField = z.infer<typeof DroppedFieldSchema>;

export const FALLBACK_REASONS = [
  'llm_not_configured',
  /** A key is set but the provider rejected it (invalid, revoked, no permission). */
  'llm_auth_failed',
  'timeout',
  'rate_limited',
  'unavailable',
  'refusal',
  'invalid_output',
  'circuit_open',
  'budget_exhausted',
] as const;
export const FallbackReasonSchema = z.enum(FALLBACK_REASONS);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

export const IntentResultSchema = z.object({
  draft: PropertyQueryDraftSchema,
  source: z.enum(['llm', 'fallback']),
  /** Why the deterministic parser was used instead of the LLM. */
  fallbackReason: FallbackReasonSchema.optional(),
  dropped: z.array(DroppedFieldSchema),
  /** Fragments of the text the parser could not map to a field. */
  unparsed: z.array(z.string()),
  /** Hebrew question for the user when something essential is missing or unclear. */
  clarificationNeeded: z.string().optional(),
  /** The city as the user wrote it, when it isn't one we have data for (e.g. "אילת"). */
  cityAsWritten: z.string().optional(),
});
export type IntentResult = z.infer<typeof IntentResultSchema>;
