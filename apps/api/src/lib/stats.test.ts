import { describe, expect, it } from 'vitest';
import { quantile } from './stats.js';

describe('quantile (type 7)', () => {
  it('interpolates between ranks', () => {
    const s = [1, 2, 3, 4];
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 0.25)).toBe(1.75);
    expect(quantile(s, 0.5)).toBe(2.5);
    expect(quantile(s, 1)).toBe(4);
  });

  it('handles a single value and rejects empty input', () => {
    expect(quantile([7], 0.75)).toBe(7);
    expect(() => quantile([], 0.5)).toThrow();
  });
});
