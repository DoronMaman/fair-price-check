export type BreakerState = 'closed' | 'open' | 'half_open';

/**
 * After `threshold` consecutive failures, stop calling for `openMs`; then let
 * one trial call through (half-open). Success closes it, failure re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(private readonly opts: { threshold: number; openMs: number; now: () => number }) {}

  state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.opts.now() - this.openedAt >= this.opts.openMs ? 'half_open' : 'open';
  }

  /** Whether a call may go out now. In half-open, reserves the single trial slot. */
  tryAcquire(): boolean {
    const s = this.state();
    if (s === 'closed') return true;
    if (s === 'half_open' && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  /** The call ended without telling us anything about health (e.g. cancelled): free the trial slot. */
  release(): void {
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    this.failures++;
    if (this.openedAt !== null || this.failures >= this.opts.threshold) this.openedAt = this.opts.now();
  }
}
