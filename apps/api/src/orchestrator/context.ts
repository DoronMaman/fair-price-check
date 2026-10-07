import { config } from '../config.js';
import { todayInIsrael, type Dataset } from '../data/loadDataset.js';
import type { IntentLlmOutput } from '../intent/prompt.js';
import { knownNeighborhoodsOf, type KnownNeighborhoods } from '../intent/validateIntent.js';
import { MemoryCache, type Cache } from '../lib/cache.js';
import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { DailyBudget, FileBudgetStore, type BudgetStore } from '../lib/dailyBudget.js';
import { env } from '../env.js';
import { Metrics } from '../lib/metrics.js';
import type { LlmClient } from '../llm/LlmClient.js';
import { ManagedLlmClient } from '../llm/managedLlmClient.js';
import { ExplanationService, type CachedExplanation } from './explanationService.js';

/** Everything a request needs. Built once at boot; injected so tests can swap parts. */
export type AppContext = {
  dataset: Dataset;
  knownNeighborhoods: KnownNeighborhoods;
  llm: ManagedLlmClient;
  breaker: CircuitBreaker;
  budget: DailyBudget;
  metrics: Metrics;
  intentCache: Cache<IntentLlmOutput>;
  answerCache: Cache<CachedExplanation>;
  explanations: ExplanationService;
  /** ms since epoch; injectable for tests. */
  now: () => number;
  today: () => string;
};

export function createContext(opts: {
  dataset: Dataset;
  llm: LlmClient;
  now?: () => number;
  /** Override config limits (tests). */
  dailyLlmCallBudget?: number;
  /** Persists the daily call counter; defaults to BUDGET_STATE_FILE when set. */
  budgetStore?: BudgetStore;
}): AppContext {
  const now = opts.now ?? Date.now;
  const today = () => todayInIsrael(new Date(now()));
  const metrics = new Metrics(today);
  const breaker = new CircuitBreaker({
    threshold: config.resilience.breakerFailureThreshold,
    openMs: config.resilience.breakerOpenMs,
    now,
  });
  const budget = new DailyBudget({
    limit: opts.dailyLlmCallBudget ?? config.abuse.dailyLlmCallBudget,
    today,
    store: opts.budgetStore ?? (env.BUDGET_STATE_FILE ? new FileBudgetStore(env.BUDGET_STATE_FILE) : undefined),
  });
  const llm = new ManagedLlmClient(opts.llm, { breaker, budget, metrics, now });
  const answerCache = new MemoryCache<CachedExplanation>({ maxEntries: config.cache.maxEntries, now });
  return {
    dataset: opts.dataset,
    knownNeighborhoods: knownNeighborhoodsOf(opts.dataset.deals),
    llm,
    breaker,
    budget,
    metrics,
    intentCache: new MemoryCache({ maxEntries: config.cache.maxEntries, now }),
    answerCache,
    explanations: new ExplanationService({ llm, cache: answerCache, metrics, now }),
    now,
    today,
  };
}
