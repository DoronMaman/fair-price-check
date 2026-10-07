// Every threshold the app depends on, with the reason for its value.
// Plausibility ranges (rooms, size, price) live in @fpc/shared LIMITS because
// the web app and the query schema need the same ones.
import { LIMITS } from '@fpc/shared';
import { env } from './env.js';

export const config = {
  data: {
    /** Path of the deals CSV, relative to apps/api. */
    csvPath: 'data/madlan_deals_sample.csv',

    /**
     * Prices below this are not residential sale prices (the file has a 0 and an
     * 18,000 — likely a typo or a rent). The cheapest plausible row is ~492K in
     * Be'er Sheva, so 300K excludes junk without touching real deals.
     */
    minValidPriceNis: LIMITS.priceNis.min,

    /**
     * Relative difference above which the CSV's price_per_sqm column counts as
     * inconsistent with price / size. 2% allows for rounding; we never use the
     * column anyway, this is only for the quality report.
     */
    pricePerSqmTolerance: 0.02,

    /**
     * Tukey "far out" fence: flag a deal when price or ₪/m² > Q3 + k·IQR within
     * its city. k = 1.5 flagged 25 deals on this data, mostly real luxury
     * penthouses and private houses. k = 3 flags only the extreme ones (incl.
     * the 38.5M and 44M deals). Flagged deals are kept but excluded from stats.
     */
    outlierIqrMultiplier: 3,

    /** IQR on fewer rows than this is noise; don't flag outliers in such a city. */
    minCityRowsForOutliers: 8,

    /** Rooms outside LIMITS.rooms (or not a multiple of 0.5) are a data error → null. */
    roomsMin: LIMITS.rooms.min,
    roomsMax: LIMITS.rooms.max,

    /** Sizes outside LIMITS.sizeSqm are treated as unknown. */
    sizeSqmMin: LIMITS.sizeSqm.min,
    sizeSqmMax: LIMITS.sizeSqm.max,

    /** Oldest plausible year_built (the file's range is 1950–2024). */
    yearBuiltMin: 1850,

    /**
     * "חדש מקבלן" with year_built before this year is reported as a contradiction.
     * 2015 is the cut-off the audit used; the row is kept as-is.
     */
    newConditionYearCutoff: 2015,
  },

  analytics: {
    /**
     * Stop widening at the first scope with at least this many usable comparables.
     * 8 is the smallest set where p25/p75 are more than "the 2nd and 6th deal";
     * with ~29 deals per city, a higher bar would almost always end at city level.
     */
    minComps: 8,

    /** Below this many comparables we return no estimate at all (INSUFFICIENT). */
    insufficientBelow: 5,

    /**
     * HIGH needs at least this many comparables at a scope that still matches
     * property type (neighborhood or city+type+rooms). With 15, the interquartile
     * range rests on ~8 deals.
     */
    highConfidenceMinComps: 15,

    /** Rooms tolerance per ladder level: ±0.5 keeps "4" with "3.5" and "4.5". */
    roomsToleranceNarrow: 0.5,
    roomsToleranceWide: 1,

    /** Number of comparables shown to the user. */
    topComparables: 5,

    /**
     * Similarity weights for ranking comparables (0–1 per component, weighted mean
     * over the components the query actually has). Rooms and size dominate because
     * they drive price most; type and neighborhood next; recency is a tie-breaker
     * because we never adjust prices for time (that would be a trend claim).
     */
    similarityWeights: { rooms: 3, size: 3, propertyType: 2, neighborhood: 2, recency: 1 },
    /** Rooms difference at which the rooms component reaches 0. */
    similarityRoomsSpan: 2,
    /** Relative size difference at which the size component reaches 0 (±40%). */
    similaritySizeSpan: 0.4,
    /** Deal age (years) at which the recency component reaches 0 — the data spans ~5 years. */
    similarityRecencyYears: 5,

    /**
     * Rounding for ₪ estimates and price stats shown to the user. A range built
     * from a handful of deals is not precise to the shekel; showing 3,912,437
     * would claim precision we don't have.
     */
    roundEstimateNis: 10_000,
    roundPricePerSqmNis: 100,
  },

  llm: {
    /**
     * Small, cheap model with structured-output support. Intent extraction is
     * short-form classification over Hebrew; a larger model is not needed.
     * The API key is read only in createLlmClient (LLM_API_KEY), never stored here.
     */
    model: env.LLM_MODEL,

    /**
     * Intent extraction must feel instant; past 2.5s the regex fallback (plus
     * editable chips) is a better experience than waiting.
     */
    intentTimeoutMs: env.LLM_INTENT_TIMEOUT_MS,

    /**
     * Output cap for the intent JSON. The full object with every field set is
     * ~150 tokens; 512 leaves room for `unparsed` and a clarification question
     * while bounding the cost of a runaway response.
     */
    intentMaxTokens: 512,

    /**
     * The explanation is not on the critical path (stats render first), so it
     * gets more time than intent — but past 4s a template is the better answer.
     */
    explainTimeoutMs: env.LLM_EXPLAIN_TIMEOUT_MS,

    /**
     * Two or three short Hebrew paragraphs plus the usedFactIds list. Hebrew
     * costs more tokens per word than English; 800 bounds a runaway answer.
     */
    explainMaxTokens: 800,
  },

  intent: {
    /**
     * Longest clarification question from the model we'll show. A question is a
     * short sentence; anything longer is the model rambling or being steered.
     */
    maxClarificationChars: 150,
  },

  metrics: {
    /** Recent LLM latencies kept for p50/p95 — enough for a stable p95, bounded memory. */
    latencyWindow: 500,
  },

  explain: {
    /**
     * First answer + one retry with the guard's violations fed back. A third try
     * rarely fixes what two didn't, and the template is always correct.
     */
    maxAttempts: 2,
    /** Enough for scope, range, verdict. More than this is padding. */
    maxParagraphs: 3,
    /** Rendered-length cap on the raw text (placeholders unexpanded). */
    maxChars: 900,
    /**
     * Don't start the retry call with less time than this left in the budget:
     * it would almost certainly time out and only add cost.
     */
    minMsForRetry: 1_000,
  },

  cache: {
    /**
     * Intent: text → LLM output. Same words mean the same thing next week; the
     * key includes the prompt version, so a prompt change invalidates it anyway.
     */
    intentTtlMs: 7 * 24 * 3600_000,
    /**
     * Answer (LLM explanation). The key includes DATA_VERSION, so new data
     * invalidates it; 24h bounds how long a wording problem can live.
     */
    answerTtlMs: 24 * 3600_000,
    /**
     * Per-layer entry cap for the in-memory LRU. An entry is ~1–3 KB, so 10k
     * entries is ~30 MB worst case — fine on the smallest instance.
     */
    maxEntries: 10_000,
  },

  resilience: {
    /** Hard ceiling per request; past it we return the deterministic result. */
    requestBudgetMs: 7_000,
    /**
     * Consecutive LLM infrastructure failures (timeout / 5xx / 429) before we
     * stop calling it. 5 avoids tripping on a single blip.
     */
    breakerFailureThreshold: 5,
    /** How long to serve templates before letting one trial call through. */
    breakerOpenMs: 30_000,
    /**
     * After the provider rejects our key (401/403), stop calling for this long.
     * A bad key won't fix itself in seconds; retrying every request would add
     * a failing round trip to each one. 10 min bounds how long a fixed key waits.
     */
    authFailureCooldownMs: 10 * 60_000,
  },

  abuse: {
    /**
     * Per-IP requests per minute on the two POST endpoints. A person checking
     * listings does a few per minute; 20 leaves room for editing chips.
     */
    perIpPerMinute: env.RATE_LIMIT_PER_MINUTE,
    /**
     * Global LLM calls per day (Israel date). Sized for 10k requests/day at
     * ≤2 calls each before caching. When it runs out, everything is served by
     * the fallback parser and templates — never an error.
     */
    dailyLlmCallBudget: env.LLM_DAILY_CALL_BUDGET,
  },

  pricing: {
    /**
     * USD per million tokens for claude-haiku-4-5, used only for the /api/metrics
     * spend estimate. Source: https://platform.claude.com/docs/en/about-claude/pricing
     * (checked 2026-10-06): $1 input / $5 output. Override with env if the model or
     * price changes.
     */
    inputUsdPerMTok: env.LLM_PRICE_INPUT_PER_MTOK,
    outputUsdPerMTok: env.LLM_PRICE_OUTPUT_PER_MTOK,
  },

  server: {
    port: env.PORT,
    host: env.HOST,
    /** See env.ts: 0 unless deployed behind exactly one proxy (render.yaml sets 1). */
    trustProxyHops: env.TRUST_PROXY_HOPS,
    /** Bearer token protecting /api/metrics; unset → the endpoint is disabled. */
    metricsToken: env.METRICS_TOKEN,
    /** The largest valid body is a 500-char text or a small query object. */
    bodyLimitBytes: 8_192,
    /**
     * How long in-flight requests get to finish on SIGTERM. Longer than the 7s
     * request budget so a request that just started can complete; shorter than
     * typical platform kill timeouts (Render/Fly give ~30s).
     */
    shutdownGraceMs: 10_000,
  },
} as const;
