// Test helper: fetch real rows from the bundled CSV by deal_id, so tests run on
// the actual problematic data rather than invented rows.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { apiRoot } from '../lib/paths.js';
import { RawRowSchema, type RawRow } from './parsers.js';

const csvPath = resolve(apiRoot(), config.data.csvPath);
export const ALL_RAW_ROWS: RawRow[] = parse<unknown>(readFileSync(csvPath), {
  columns: true,
  bom: true,
  skip_empty_lines: true,
}).map((r) => RawRowSchema.parse(r));

/** Every raw row with this deal_id (duplicates included), in file order. */
export function realRows(dealId: string): RawRow[] {
  const rows = ALL_RAW_ROWS.filter((r) => r.deal_id === dealId);
  if (rows.length === 0) throw new Error(`No row ${dealId} in the CSV`);
  return rows;
}

export function realRow(dealId: string): RawRow {
  return realRows(dealId)[0]!;
}
