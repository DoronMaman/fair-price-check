import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';

/**
 * The apps/api directory, found by walking up to its package.json. Works the
 * same from src/ (tsx, tests) and from the esbuild bundle in dist/, where a
 * fixed "../.." would point somewhere else.
 */
export function apiRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@fpc/api') return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`apps/api package.json not found above ${from}`);
    dir = parent;
  }
}

/** Built frontend (apps/web/dist). Overridable for unusual layouts. */
export function webDistDir(): string {
  return env.WEB_DIST_DIR ?? resolve(apiRoot(), '../web/dist');
}
