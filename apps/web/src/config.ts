// Frontend tunables, each with its reason (the API's live in apps/api/src/config.ts).
export const webConfig = {
  /** The server answers within its 7s budget; leave room for the network before giving up. */
  clientTimeoutMs: 12_000,
  /**
   * The asking-price label on the range bar is clamped to this band (percent of the
   * bar) so it never hangs off either edge; the marker itself is not clamped.
   */
  rangeLabelClampPct: { min: 8, max: 92 },
} as const;
