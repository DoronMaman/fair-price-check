import { describe, expect, it } from 'vitest';
import { MemoryCache } from './cache.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyBudget, FileBudgetStore } from './dailyBudget.js';

describe('MemoryCache', () => {
  it('expires entries after their TTL', async () => {
    let t = 1_000;
    const cache = new MemoryCache<string>({ maxEntries: 10, now: () => t });
    await cache.set('k', 'v', 5_000);
    t += 4_999;
    expect(await cache.get('k')).toBe('v');
    t += 2;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('evicts least-recently-used entries beyond maxEntries', async () => {
    const cache = new MemoryCache<string>({ maxEntries: 2 });
    await cache.set('a', '1', 60_000);
    await cache.set('b', '2', 60_000);
    await cache.get('a'); // a is now most recent
    await cache.set('c', '3', 60_000);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe('1');
  });
});

describe('CircuitBreaker', () => {
  const make = () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 3, openMs: 10_000, now: () => t });
    return { b, advance: (ms: number) => (t += ms) };
  };

  it('opens after N consecutive failures', () => {
    const { b } = make();
    b.recordFailure();
    b.recordFailure();
    expect(b.state()).toBe('closed');
    b.recordFailure();
    expect(b.state()).toBe('open');
    expect(b.tryAcquire()).toBe(false);
  });

  it('a success resets the failure count', () => {
    const { b } = make();
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    expect(b.state()).toBe('closed');
  });

  it('half-open lets exactly one trial through; success closes', () => {
    const { b, advance } = make();
    for (let i = 0; i < 3; i++) b.recordFailure();
    advance(10_000);
    expect(b.state()).toBe('half_open');
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false); // second concurrent caller is refused
    b.recordSuccess();
    expect(b.state()).toBe('closed');
  });

  it('a failed trial re-opens for another full period', () => {
    const { b, advance } = make();
    for (let i = 0; i < 3; i++) b.recordFailure();
    advance(10_000);
    b.tryAcquire();
    b.recordFailure();
    expect(b.state()).toBe('open');
    advance(9_999);
    expect(b.state()).toBe('open');
  });
});

describe('DailyBudget', () => {
  it('stops at the limit and resets on a new day', () => {
    let day = '2026-10-06';
    const budget = new DailyBudget({ limit: 2, today: () => day });
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.hasRemaining()).toBe(false);
    day = '2026-10-07';
    expect(budget.hasRemaining()).toBe(true);
    expect(budget.snapshot()).toMatchObject({ day: '2026-10-07', used: 0, limit: 2 });
  });

  it('with a file store, a restart does not hand out a fresh budget', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'budget-')), 'state', 'budget.json');
    const first = new DailyBudget({ limit: 3, today: () => '2026-10-07', store: new FileBudgetStore(file) });
    first.tryConsume();
    first.tryConsume();
    // "Restart": a new process reads the same file.
    const second = new DailyBudget({ limit: 3, today: () => '2026-10-07', store: new FileBudgetStore(file) });
    expect(second.snapshot()).toMatchObject({ used: 2, persisted: true });
    expect(second.tryConsume()).toBe(true);
    expect(second.tryConsume()).toBe(false);
    // A saved count from an earlier day is ignored.
    const nextDay = new DailyBudget({ limit: 3, today: () => '2026-10-08', store: new FileBudgetStore(file) });
    expect(nextDay.snapshot().used).toBe(0);
  });

  it('a missing or corrupt state file starts at 0 instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const file = join(dir, 'budget.json');
    expect(new DailyBudget({ limit: 3, today: () => 'd', store: new FileBudgetStore(file) }).snapshot().used).toBe(0);
    writeFileSync(file, '{not json');
    expect(new DailyBudget({ limit: 3, today: () => 'd', store: new FileBudgetStore(file) }).snapshot().used).toBe(0);
  });
});
