// Production build of the API: one ESM file with our code + @fpc/shared (TS source)
// compiled in. Third-party packages stay external and load from node_modules,
// so libraries with runtime file lookups (pino, fastify plugins) behave normally.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@fpc/shared');

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external,
  logLevel: 'info',
});
