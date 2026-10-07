import { describe, expect, it } from 'vitest';
import { DataQualityReportSchema, NormalizedDealSchema } from '@fpc/shared';
import { computeDataVersion, loadDataset, todayInIsrael } from './loadDataset.js';

// Acceptance check for Stage 1: the report on the real CSV matches the audit.
describe('loadDataset on the real CSV', () => {
  const { deals, report, dataVersion } = loadDataset({ today: '2026-10-06' });

  it('produces schema-valid deals and report', () => {
    for (const d of deals) NormalizedDealSchema.parse(d);
    DataQualityReportSchema.parse(report);
  });

  it('row accounting: 530 raw − 6 exact dupes − 2 bad prices − 4 conflicts = 518', () => {
    expect(report.rawRows).toBe(530);
    expect(report.duplicates.exactDropped).toBe(6);
    expect(report.duplicates.conflicts.map((c) => c.dealId).sort()).toEqual([
      'D100017',
      'D100032',
      'D100124',
      'D100303',
    ]);
    expect(report.rejected.map((r) => [r.dealId, r.reason])).toEqual([
      ['D100317', 'price_below_min'],
      ['D100251', 'price_below_min'],
    ]);
    expect(report.validDeals).toBe(518);
    expect(deals).toHaveLength(518);
    expect(new Set(deals.map((d) => d.dealId)).size).toBe(518);
  });

  it('field issue counts match the audit table', () => {
    const f = report.fieldIssues;
    expect(f.city.rawSpellings).toBe(29);
    expect(f.city.canonicalCities).toBe(18);
    expect(f.neighborhood.missing).toBe(11);
    expect(f.condition.missing).toBe(16);
    expect(f.condition.newFromContractorBuiltBefore2015).toBe(85);
    expect(f.price).toEqual({ withCommas: 56, withShekelSign: 12 });
    expect(f.sizeSqm.missing).toBe(10);
    expect(f.pricePerSqmColumn).toMatchObject({ missing: 10, zero: 2, inconsistentWithPriceAndSize: 28 });
    expect(f.booleans.spellings).toHaveLength(8);
    expect(f.booleans.unknownByField.has_parking).toBe(20);
    expect(f.dealDate.byFormat).toEqual({ iso: 373, dot: 55, slash: 76, monthYear: 26, unparseable: 0 });
    expect(f.dealDate.ambiguousDayMonth).toBe(56);
    expect(f.yearBuilt.missing).toBe(35);
  });

  it('flags the extreme deals as outliers', () => {
    const ids = report.outliers.map((o) => o.dealId);
    expect(ids).toEqual(expect.arrayContaining(['D100001', 'D100193']));
  });

  it('no deal is dated after today', () => {
    expect(deals.every((d) => d.dealDate <= '2026-10-06')).toBe(true);
  });

  it('dataVersion is a stable content hash', () => {
    expect(dataVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(computeDataVersion(Buffer.from('a'))).not.toBe(computeDataVersion(Buffer.from('b')));
  });
});

describe('todayInIsrael', () => {
  it('uses the Israel date, not UTC (23:30 UTC on Oct 5 is already Oct 6 in Israel)', () => {
    expect(todayInIsrael(new Date('2026-10-05T23:30:00Z'))).toBe('2026-10-06');
  });
});
