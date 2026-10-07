/**
 * Canonical form of user input: NFC, Hebrew gershayim/geresh and curly quotes
 * unified to ASCII " and ', whitespace collapsed. Used for cache keys and before
 * parsing, so "ת״א" and "ת\"א" are the same request.
 */
export function normalizeInputText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
