import { describe, expect, it } from 'vitest';
import { AnalysisResultSchema, stripBidi, type PropertyQuery } from '@fpc/shared';
import { loadDataset } from '../data/loadDataset.js';
import { analyze, confidenceFor, verdictFor } from './analyze.js';

const TODAY = '2026-10-06';
const ds = loadDataset({ today: TODAY });
const run = (q: PropertyQuery, deals = ds.deals) =>
  analyze(q, { deals, dataVersion: ds.dataVersion }, { today: TODAY });

// The example from the brief: 4 rooms in Givatayim, 95 m², asking 3.9M.
const GIVATAYIM: PropertyQuery = {
  city: 'גבעתיים',
  propertyType: 'apartment',
  rooms: 4,
  sizeSqm: 95,
  askingPriceNis: 3_900_000,
};

describe('widening ladder (real data)', () => {
  it('level 1 — neighborhood: חולון / קריית שרת has 11 deals', () => {
    const r = run({ city: 'חולון', neighborhood: 'קריית שרת' });
    expect(r.scope).toBe('neighborhood');
    expect(r.appliedCriteria).toEqual({ city: 'חולון', neighborhood: 'קריית שרת' });
    expect(r.nComps).toBe(11);
    expect(r.comparables.every((c) => c.neighborhood === 'קריית שרת')).toBe(true);
  });

  it('level 1 widens when the neighborhood + type + rooms set is too small', () => {
    // גבעת רמב"ם has at most 6 apartments, below MIN_COMPS.
    const r = run({ ...GIVATAYIM, neighborhood: 'גבעת רמב"ם' });
    expect(r.scope).not.toBe('neighborhood');
  });

  it('level 2 — city + type + rooms ±0.5: Givatayim 4-room apartments', () => {
    const r = run(GIVATAYIM);
    expect(r.scope).toBe('city_type_rooms');
    expect(r.appliedCriteria).toEqual({ city: 'גבעתיים', propertyType: 'apartment', rooms: { min: 3.5, max: 4.5 } });
    expect(r.nComps).toBe(8);
    for (const c of r.comparables) {
      expect(c.propertyType).toBe('apartment');
      expect(c.rooms).toBeGreaterThanOrEqual(3.5);
      expect(c.rooms).toBeLessThanOrEqual(4.5);
    }
  });

  it('level 3 — city + rooms ±1: 3-room apartment in Holon (too few at level 2)', () => {
    const r = run({ city: 'חולון', propertyType: 'apartment', rooms: 3, sizeSqm: 75 });
    expect(r.scope).toBe('city_rooms');
    expect(r.appliedCriteria).toEqual({ city: 'חולון', rooms: { min: 2, max: 4 } });
  });

  it('level 4 — city only: a 6-room private house in Tel Aviv', () => {
    const r = run({ city: 'תל אביב-יפו', propertyType: 'private_house', rooms: 6, sizeSqm: 200 });
    expect(r.scope).toBe('city');
    expect(r.appliedCriteria).toEqual({ city: 'תל אביב-יפו' });
    expect(r.confidence).toBe('LOW');
  });
});

describe('INSUFFICIENT', () => {
  // Only 4 real Givatayim deals available → below the floor of 5.
  const fourDeals = ds.deals.filter((d) => d.city === 'גבעתיים' && !d.isOutlier).slice(0, 4);
  const r = run(GIVATAYIM, fourDeals);

  it('returns no estimate, stats or verdict at all', () => {
    expect(r.confidence).toBe('INSUFFICIENT');
    expect(r.nComps).toBe(4);
    expect(r.stats).toBeNull();
    expect(r.estimate).toBeNull();
    expect(r.verdict).toBeNull();
  });

  it('still shows what there is', () => {
    expect(r.comparables).toHaveLength(4);
  });

  it('exposes no price facts', () => {
    expect(Object.keys(r.facts).sort()).toEqual(['city', 'n_comps', 'scope_label']);
  });
});

describe('asking price never filters comparables', () => {
  it('median, range and comparables are identical for a 1M, 3.9M and 40M asking price', () => {
    const base = run({ ...GIVATAYIM, askingPriceNis: undefined });
    for (const asking of [1_000_000, 3_900_000, 40_000_000]) {
      const r = run({ ...GIVATAYIM, askingPriceNis: asking });
      expect(r.stats).toEqual(base.stats);
      expect(r.estimate).toEqual(base.estimate);
      expect(r.comparables).toEqual(base.comparables);
      expect(r.nComps).toBe(base.nComps);
    }
  });
});

describe('stats and estimate', () => {
  it('uses ₪/m² × size when a size is given', () => {
    const r = run(GIVATAYIM);
    expect(r.basis).toBe('pricePerSqm');
    expect(r.estimate!.median).toBe(Math.round((r.stats!.median * 95) / 10_000) * 10_000);
    expect(r.stats!.p25).toBeLessThanOrEqual(r.stats!.median);
    expect(r.stats!.median).toBeLessThanOrEqual(r.stats!.p75);
  });

  it('uses total price when no size is given, and includes deals without a size', () => {
    const r = run({ city: 'גבעתיים', rooms: 4 });
    expect(r.basis).toBe('price');
    expect(r.facts.median_ppsqm).toBeUndefined();
  });

  it('the ₪/m² basis skips deals without size (D100223 has none)', () => {
    const r = run({ city: 'תל אביב-יפו', sizeSqm: 100 });
    expect(r.comparables.map((c) => c.dealId)).not.toContain('D100223');
  });

  it('excludes flagged outliers from stats but lists them (D100035, Givatayim)', () => {
    const r = run({ city: 'גבעתיים' });
    expect(r.excludedOutliers.map((c) => c.dealId)).toEqual(['D100035']);
    expect(r.stats!.max).toBeLessThan(22_532_000);
    expect(r.facts.n_outliers_excluded?.value).toBe(1);
  });

  it('reports the deal-date range of the comparables', () => {
    const r = run(GIVATAYIM);
    expect(r.stats!.dateFrom <= r.stats!.dateTo).toBe(true);
    expect(stripBidi(r.facts.date_range_years!.formatted)).toMatch(/^\d{4}(–\d{4})?$/);
  });

  it('the result matches the shared API schema', () => {
    expect(() => AnalysisResultSchema.parse(run(GIVATAYIM))).not.toThrow();
  });
});

describe('verdict', () => {
  const est = { low: 4_460_000, median: 5_010_000, high: 5_880_000 };

  it.each([
    [3_900_000, 'below_range'],
    [4_460_000, 'within_range'], // boundary counts as within
    [5_010_000, 'within_range'],
    [5_880_000, 'within_range'],
    [6_000_000, 'above_range'],
  ] as const)('%d → %s', (asking, verdict) => {
    expect(verdictFor(asking, est).verdict).toBe(verdict);
  });

  it('askingVsMedian is signed', () => {
    expect(verdictFor(4_509_000, est).askingVsMedian).toBeCloseTo(-0.1, 6);
    expect(verdictFor(5_511_000, est).askingVsMedian).toBeCloseTo(0.1, 6);
  });

  it('Givatayim example: 3.9M is below the comparable range', () => {
    const r = run(GIVATAYIM);
    expect(r.verdict!.verdict).toBe('below_range');
    expect(r.verdict!.askingVsMedian).toBeLessThan(0);
  });

  it('no asking price → no verdict, but still an estimate', () => {
    const r = run({ ...GIVATAYIM, askingPriceNis: undefined });
    expect(r.verdict).toBeNull();
    expect(r.estimate).not.toBeNull();
    expect(r.facts.asking_price).toBeUndefined();
  });
});

describe('confidenceFor', () => {
  it.each([
    [4, 'neighborhood', 'pricePerSqm', 'INSUFFICIENT'],
    [5, 'city', 'pricePerSqm', 'LOW'],
    [7, 'city_type_rooms', 'pricePerSqm', 'LOW'], // below MIN_COMPS at any level
    [15, 'neighborhood', 'pricePerSqm', 'HIGH'],
    [15, 'city_type_rooms', 'pricePerSqm', 'HIGH'],
    [15, 'city_type_rooms', 'price', 'MEDIUM'], // total price mixes sizes
    [14, 'city_type_rooms', 'pricePerSqm', 'MEDIUM'],
    [40, 'city_rooms', 'pricePerSqm', 'MEDIUM'],
    [40, 'city', 'pricePerSqm', 'LOW'],
  ] as const)('n=%d at %s (%s) → %s', (n, scope, basis, expected) => {
    expect(confidenceFor(n, scope, basis)).toBe(expected);
  });
});

describe('determinism', () => {
  it('same input → same output', () => {
    expect(run(GIVATAYIM)).toEqual(run(GIVATAYIM));
  });
});

describe('city index', () => {
  it('using the boot-time byCity index gives exactly the same result as scanning all deals', () => {
    for (const q of [GIVATAYIM, { city: 'חולון' as const, rooms: 3 }, { city: 'תל אביב-יפו' as const, sizeSqm: 100 }]) {
      const indexed = analyze(q, ds, { today: TODAY });
      const scanned = analyze(q, { deals: ds.deals, dataVersion: ds.dataVersion }, { today: TODAY });
      expect(indexed).toEqual(scanned);
    }
  });
});
