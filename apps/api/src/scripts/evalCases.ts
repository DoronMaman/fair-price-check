import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PropertyQueryDraftSchema } from '@fpc/shared';
import { apiRoot } from '../lib/paths.js';

export const REPO_ROOT = resolve(apiRoot(), '../..');
export const RESULTS_DIR = resolve(REPO_ROOT, 'evals/results');

export const EvalCaseSchema = z.object({
  id: z.number(),
  tags: z.array(z.string()),
  input: z.string(),
  expected: PropertyQueryDraftSchema,
  expectClarification: z.boolean().optional(),
  expectCityAsWritten: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export function loadIntentCases(): EvalCase[] {
  return readFileSync(resolve(REPO_ROOT, 'evals/intent.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => EvalCaseSchema.parse(JSON.parse(l)));
}

export function saveResult(prefix: string, data: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = resolve(RESULTS_DIR, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Most recent results file with this prefix (timestamped names sort chronologically). */
export function latestResult(prefix: string): string | null {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json'))
    .sort();
  return files.length ? resolve(RESULTS_DIR, files[files.length - 1]!) : null;
}
