import { z } from 'zod';
import { FactIdSchema } from './analysis.js';
import { FALLBACK_REASONS } from './intent.js';

/**
 * A rendered explanation. Every number the user sees is a `fact` segment whose
 * text was produced by code from the FactSheet — the UI highlights it and can
 * show the fact's description on hover.
 */
export const ExplanationSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('fact'), factId: FactIdSchema, text: z.string() }),
]);
export type ExplanationSegment = z.infer<typeof ExplanationSegmentSchema>;

export const EXPLANATION_FALLBACK_REASONS = [
  ...FALLBACK_REASONS,
  /** INSUFFICIENT confidence: nothing to explain beyond the count; the LLM isn't called. */
  'insufficient_data',
  /** The LLM answered twice and both answers failed the fact guard. */
  'guard_failed',
] as const;
export const ExplanationFallbackReasonSchema = z.enum(EXPLANATION_FALLBACK_REASONS);
export type ExplanationFallbackReason = z.infer<typeof ExplanationFallbackReasonSchema>;

export const ExplanationSchema = z.object({
  source: z.enum(['llm', 'template']),
  paragraphs: z.array(z.array(ExplanationSegmentSchema)),
  fallbackReason: ExplanationFallbackReasonSchema.optional(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;
