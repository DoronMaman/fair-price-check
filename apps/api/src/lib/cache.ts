import { LRUCache } from 'lru-cache';

/**
 * Async on purpose, so a Redis implementation is a drop-in replacement for the
 * in-memory one (single instance today; shared cache when scaled out).
 */
export interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
}

// lru-cache only stores non-nullish values; NonNullable<unknown> is that constraint.
export class MemoryCache<T extends NonNullable<unknown>> implements Cache<T> {
  private readonly lru: LRUCache<string, T>;

  constructor(opts: { maxEntries: number; now?: () => number }) {
    this.lru = new LRUCache<string, T>({
      max: opts.maxEntries,
      ttlAutopurge: false,
      // Read the clock on every staleness check (the default caches "now" for 1ms via
      // a timer, which also ignores an injected clock). Negligible cost at our volume.
      ttlResolution: 0,
      // Injected clock so TTL expiry is testable without waiting.
      ...(opts.now ? { perf: { now: opts.now } } : {}),
    });
  }

  async get(key: string): Promise<T | undefined> {
    return this.lru.get(key);
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    this.lru.set(key, value, { ttl: ttlMs });
  }

  get size(): number {
    return this.lru.size;
  }
}
