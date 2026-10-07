// Entry point: load + normalize the CSV once, build the app, listen.
import { config } from '../config.js';
import { env } from '../env.js';
import { loadDataset } from '../data/loadDataset.js';
import { webDistDir } from '../lib/paths.js';
import { createLlmClient } from '../llm/createLlmClient.js';
import { createContext } from '../orchestrator/context.js';
import { buildApp } from './app.js';

const dataset = loadDataset();
const llm = createLlmClient();
const ctx = createContext({ dataset, llm });
const app = await buildApp(ctx, {
  logger: { level: env.LOG_LEVEL },
  webDist: webDistDir(),
});

const r = dataset.report;
app.log.info(
  {
    dataVersion: dataset.dataVersion,
    rawRows: r.rawRows,
    validDeals: r.validDeals,
    exactDuplicatesDropped: r.duplicates.exactDropped,
    rejected: r.rejected.length,
    outliers: r.outliers.length,
    llm: ctx.llm.configured ? config.llm.model : 'not configured — template mode',
  },
  'dataset loaded',
);
// Every duplicate-ID resolution, as required: which source won and what was dropped.
for (const c of r.duplicates.conflicts)
  app.log.info({ conflict: c }, 'duplicate deal_id resolved by source precedence');
for (const x of r.rejected) app.log.info({ rejected: x }, 'row rejected');

if (!ctx.budget.snapshot().persisted) {
  app.log.warn('BUDGET_STATE_FILE not set: the daily LLM call counter resets on every restart');
}

await app.listen({ port: config.server.port, host: config.server.host });

// Graceful shutdown: on deploy/stop, stop accepting connections and let in-flight requests
// (including paid LLM calls) finish, up to a deadline, instead of cutting them off.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      app.log.error('shutdown deadline passed; exiting with requests still open');
      process.exit(1);
    }, config.server.shutdownGraceMs);
    force.unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}
