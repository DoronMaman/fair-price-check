// Plausibility ranges shared by the CSV normalizer, the query schema and the
// LLM post-validation, so "valid" means the same thing everywhere.
export const LIMITS = {
  /** Israeli listings count rooms in halves; 10+ is not a residential unit in this data. */
  rooms: { min: 1, max: 10, step: 0.5 },
  /** Residential size range; the CSV spans 21–310 m². */
  sizeSqm: { min: 15, max: 500 },
  /**
   * Asking price range. Below 300K is not a sale price (the CSV's 0 and 18,000 rows);
   * 50M sits above the most expensive recorded deal (44M).
   */
  priceNis: { min: 300_000, max: 50_000_000 },
  /** Basement levels to tall towers. */
  floor: { min: -3, max: 60 },
  /**
   * Longest accepted free-text input. A listing description is a sentence or
   * two; longer text is a pasted ad (or abuse), and every char is paid input tokens.
   */
  inputText: { maxChars: 500 },
} as const;
