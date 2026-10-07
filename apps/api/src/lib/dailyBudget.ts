import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type BudgetState = { day: string; used: number };

/** Where the counter survives restarts. Synchronous: one tiny write per LLM call. */
export interface BudgetStore {
  load(): BudgetState | null;
  save(state: BudgetState): void;
}

/**
 * JSON file, written atomically (temp file + rename) so a crash mid-write can't
 * corrupt it. Correct for a single instance with a persistent disk; several
 * instances need a shared atomic counter (Redis INCR) instead.
 */
export class FileBudgetStore implements BudgetStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): BudgetState | null {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<BudgetState>;
      return typeof s.day === 'string' && Number.isInteger(s.used) ? { day: s.day, used: s.used! } : null;
    } catch {
      return null; // missing or unreadable → start the day at 0
    }
  }

  save(state: BudgetState): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.path);
  }
}

/**
 * A counter that resets when `today()` changes (Israel date in production).
 * With a store, the count survives restarts and deploys — otherwise every
 * restart would hand out a fresh day's budget.
 */
export class DailyBudget {
  private day: string;
  private used: number;

  constructor(private readonly opts: { limit: number; today: () => string; store?: BudgetStore | undefined }) {
    this.day = opts.today();
    const saved = opts.store?.load();
    this.used = saved && saved.day === this.day ? saved.used : 0;
  }

  private roll(): void {
    const t = this.opts.today();
    if (t !== this.day) {
      this.day = t;
      this.used = 0;
    }
  }

  /** Takes one unit if available. */
  tryConsume(): boolean {
    this.roll();
    if (this.used >= this.opts.limit) return false;
    this.used++;
    this.opts.store?.save({ day: this.day, used: this.used });
    return true;
  }

  hasRemaining(): boolean {
    this.roll();
    return this.used < this.opts.limit;
  }

  snapshot(): { day: string; used: number; limit: number; persisted: boolean } {
    this.roll();
    return { day: this.day, used: this.used, limit: this.opts.limit, persisted: this.opts.store !== undefined };
  }
}
