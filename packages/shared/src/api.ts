import { z } from 'zod';
import { AnalysisResultSchema } from './analysis.js';
import { ExplanationSchema } from './explanation.js';
import { DroppedFieldSchema, IntentResultSchema, PropertyQueryDraftSchema } from './intent.js';
import { LIMITS } from './limits.js';
import { PropertyQuerySchema } from './query.js';

/**
 * POST /api/analyze — free text (first search) or an edited query (from the chips).
 * Fast: intent + deterministic analysis, plus an explanation only if one is cached
 * or the LLM isn't available (then the template).
 */
export const AnalyzeRequestSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(LIMITS.inputText.maxChars) }).strict(),
  z.object({ query: PropertyQueryDraftSchema.strict() }).strict(),
]);
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const AnalyzeResponseSchema = z.object({
  dataVersion: z.string(),
  /** Present when the request was free text. */
  intent: IntentResultSchema.nullable(),
  /** The validated query that was analyzed (or would be, once a city is chosen). */
  draft: PropertyQueryDraftSchema,
  /** Fields refused by validation (from the parser or from an edited query). */
  dropped: z.array(DroppedFieldSchema),
  /** Null until there is a city. */
  analysis: AnalysisResultSchema.nullable(),
  explanation: ExplanationSchema.nullable(),
  /** True → call POST /api/explain with `draft` for the LLM explanation. */
  explanationPending: z.boolean(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

/** POST /api/explain — always answers (LLM, or template on any failure). */
export const ExplainRequestSchema = z.object({ query: PropertyQuerySchema.strict() }).strict();
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const ExplainResponseSchema = z.object({
  dataVersion: z.string(),
  explanation: ExplanationSchema,
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.enum(['invalid_request', 'not_found', 'unauthorized', 'rate_limited', 'internal']),
  message: z.string(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
