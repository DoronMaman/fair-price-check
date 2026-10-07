import { describe, expect, it } from 'vitest';
import { loadDataset } from '../data/loadDataset.js';
import { rankBySimilarity, similarity } from './similarity.js';

const TODAY = '2026-10-06';
const deals = loadDataset({ today: TODAY }).deals;
const deal = (id: string) => deals.find((d) => d.dealId === id)!;

describe('similarity', () => {
  // D100479: Holon, נאות רחל, apartment, 2 rooms, 68 m², 2024-10-15.
  const base = deal('D100479');

  it('is 1 for the deal itself when it is brand new', () => {
    const q = {
      city: base.city,
      neighborhood: base.neighborhood!,
      propertyType: base.propertyType,
      rooms: 2,
      sizeSqm: 68,
    };
    expect(similarity({ ...base, dealDate: TODAY }, q, TODAY)).toBe(1);
  });

  it('is in [0, 1] and drops as rooms and size diverge', () => {
    const near = similarity(base, { city: 'חולון', rooms: 2, sizeSqm: 70 }, TODAY);
    const far = similarity(base, { city: 'חולון', rooms: 4, sizeSqm: 120 }, TODAY);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThanOrEqual(1);
  });

  it('unknown size scores 0 on size, not neutral (D100223 has no size)', () => {
    const d = deal('D100223');
    const withSize = { ...d, sizeSqm: 100 };
    const q = { city: d.city, sizeSqm: 100 };
    expect(similarity(d, q, TODAY)).toBeLessThan(similarity(withSize, q, TODAY));
  });

  it('only scores features the query has (city-only query → recency alone)', () => {
    expect(similarity({ ...base, dealDate: TODAY }, { city: 'חולון' }, TODAY)).toBe(1);
  });
});

describe('rankBySimilarity', () => {
  it('is deterministic and most-similar first', () => {
    const holon = deals.filter((d) => d.city === 'חולון');
    const q = { city: 'חולון' as const, rooms: 3, sizeSqm: 75 };
    const a = rankBySimilarity(holon, q, TODAY);
    expect(a).toEqual(rankBySimilarity([...holon].reverse(), q, TODAY));
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.similarity).toBeGreaterThanOrEqual(a[i]!.similarity);
  });
});
