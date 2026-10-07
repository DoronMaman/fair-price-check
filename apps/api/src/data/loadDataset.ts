import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { DataQualityReport, NormalizedDeal } from '@fpc/shared';
import { config } from '../config.js';
import { env } from '../env.js';
import { apiRoot } from '../lib/paths.js';
import { normalizeDataset } from './normalize.js';

export type Dataset = {
  dataVersion: string;
  deals: NormalizedDeal[];
  /** Deals per city, built once: every analysis is scoped to one city. */
  byCity: ReadonlyMap<string, NormalizedDeal[]>;
  report: DataQualityReport;
};

export function indexByCity(deals: NormalizedDeal[]): Map<string, NormalizedDeal[]> {
  const map = new Map<string, NormalizedDeal[]>();
  for (const d of deals) {
    const list = map.get(d.city);
    if (list) list.push(d);
    else map.set(d.city, [d]);
  }
  return map;
}

/** Today's date in Israel as YYYY-MM-DD — the reference for "no future deal dates". */
export function todayInIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

/** Short content hash of the CSV. Goes into every cache key and response. */
export function computeDataVersion(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/** Runs once at boot; the dataset is small enough to keep in memory. */
export function loadDataset(opts: { csvPath?: string; today?: string } = {}): Dataset {
  const bytes = readFileSync(resolve(apiRoot(), opts.csvPath ?? env.DATA_CSV_PATH ?? config.data.csvPath));
  const dataVersion = computeDataVersion(bytes);
  const rawRows: unknown[] = parse(bytes, { columns: true, bom: true, skip_empty_lines: true });
  const { deals, report } = normalizeDataset(rawRows, { today: opts.today ?? todayInIsrael(), dataVersion });
  return { dataVersion, deals, byCity: indexByCity(deals), report };
}
