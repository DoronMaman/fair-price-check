/**
 * Quantile with linear interpolation between closest ranks (Hyndman & Fan type 7,
 * the default in numpy, R and Excel's PERCENTILE.INC), so results can be checked by hand.
 * `sorted` must be ascending and non-empty.
 */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('quantile of empty array');
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

export function sortedAsc(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}
