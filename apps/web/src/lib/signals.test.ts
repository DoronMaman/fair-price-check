import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeoutSignal } from './signals';

afterEach(() => vi.useRealTimers());

describe('timeoutSignal', () => {
  it('aborts after the timeout and says so', () => {
    vi.useFakeTimers();
    const t = timeoutSignal(1_000);
    vi.advanceTimersByTime(999);
    expect(t.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(true);
  });

  it('aborts when the parent aborts (not a timeout)', () => {
    const parent = new AbortController();
    const t = timeoutSignal(60_000, parent.signal);
    parent.abort();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.dispose();
  });

  it('dispose stops the timer', () => {
    vi.useFakeTimers();
    const t = timeoutSignal(1_000);
    t.dispose();
    vi.advanceTimersByTime(5_000);
    expect(t.signal.aborted).toBe(false);
  });

  it('does not depend on AbortSignal.any / AbortSignal.timeout (missing on older Safari)', () => {
    const any = AbortSignal.any;
    const timeout = AbortSignal.timeout;
    try {
      // @ts-expect-error simulate an older browser
      AbortSignal.any = undefined;
      // @ts-expect-error simulate an older browser
      AbortSignal.timeout = undefined;
      expect(() => timeoutSignal(10, new AbortController().signal).dispose()).not.toThrow();
    } finally {
      AbortSignal.any = any;
      AbortSignal.timeout = timeout;
    }
  });
});
