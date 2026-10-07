import { z } from 'zod';

const int = (def: number, min = 1) => z.coerce.number().int().min(min).default(def);

/**
 * Every environment variable the API reads, validated once at boot. A typo or a
 * bad value stops the process with a clear message instead of silently falling
 * back (or becoming NaN in the spend metric).
 */
export const EnvSchema = z.object({
  PORT: int(3000).pipe(z.number().max(65_535)),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Unset → template mode (regex parser + code-written explanation). */
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  LLM_INTENT_TIMEOUT_MS: int(2_500),
  LLM_EXPLAIN_TIMEOUT_MS: int(4_000),
  LLM_DAILY_CALL_BUDGET: int(20_000),
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(1),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().default(5),
  /** Dev/eval only: save every raw LLM request/response here for contract tests. */
  LLM_RECORD_DIR: z.string().optional(),
  /** Where the daily LLM-call counter survives restarts. Unset → in memory only. */
  BUDGET_STATE_FILE: z.string().optional(),

  RATE_LIMIT_PER_MINUTE: int(20),
  /**
   * Proxy hops to trust for the client IP. 0 (default) = use the socket address;
   * set 1 only behind exactly one proxy (Render, Fly). Trusting a hop that isn't
   * there lets clients spoof X-Forwarded-For and dodge the per-IP limit.
   */
  TRUST_PROXY_HOPS: int(0, 0).pipe(z.number().max(5)),
  /** Bearer token for /api/metrics. Unset → /api/metrics is disabled (404). */
  METRICS_TOKEN: z.string().min(16, 'METRICS_TOKEN must be at least 16 characters').optional(),

  DATA_CSV_PATH: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
});
export type Env = z.infer<typeof EnvSchema>;

/** Empty strings count as unset (common in dashboards and .env files). */
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}

export const env = parseEnv();
