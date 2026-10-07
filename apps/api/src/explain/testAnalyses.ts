// Real analyses (from the bundled CSV) covering every verdict / basis / confidence
// branch, shared by the explain tests.
import type { AnalysisResult, PropertyQuery } from '@fpc/shared';
import { analyze } from '../analytics/analyze.js';
import { loadDataset } from '../data/loadDataset.js';

const TODAY = '2026-10-06';
const ds = loadDataset({ today: TODAY });
const run = (q: PropertyQuery, deals = ds.deals) =>
  analyze(q, { deals, dataVersion: ds.dataVersion }, { today: TODAY });

const GIVATAYIM: PropertyQuery = { city: 'גבעתיים', propertyType: 'apartment', rooms: 4, sizeSqm: 95 };
const est = run(GIVATAYIM).estimate!;

export const ANALYSES = {
  below: run({ ...GIVATAYIM, askingPriceNis: 3_900_000 }),
  within: run({ ...GIVATAYIM, askingPriceNis: est.median }),
  withinAbove: run({ ...GIVATAYIM, askingPriceNis: est.median + 200_000 }),
  above: run({ ...GIVATAYIM, askingPriceNis: est.high + 500_000 }),
  noAsking: run(GIVATAYIM),
  priceBasis: run({ city: 'גבעתיים', rooms: 4, askingPriceNis: 5_000_000 }),
  lowWithOutlier: run({ city: 'גבעתיים', sizeSqm: 100, askingPriceNis: 5_000_000 }),
  insufficient: run(GIVATAYIM, ds.deals.filter((d) => d.city === 'גבעתיים' && !d.isOutlier).slice(0, 4)),
} satisfies Record<string, AnalysisResult>;
