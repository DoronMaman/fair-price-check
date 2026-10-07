import { describe, expect, it } from 'vitest';
import { loadDataset } from '../data/loadDataset.js';
import { knownNeighborhoodsOf, validateIntent } from './validateIntent.js';

const ctx = { knownNeighborhoods: knownNeighborhoodsOf(loadDataset({ today: '2026-10-06' }).deals) };
const v = (c: Parameters<typeof validateIntent>[0]) => validateIntent(c, ctx);

describe('validateIntent', () => {
  it('passes a clean query through unchanged', () => {
    const q = {
      city: 'גבעתיים',
      propertyType: 'apartment',
      rooms: 4,
      sizeSqm: 95,
      floor: 3,
      hasElevator: true,
      askingPriceNis: 3_900_000,
    };
    expect(v(q)).toEqual({ draft: q, dropped: [] });
  });

  it('resolves city aliases through canonicalCity()', () => {
    expect(v({ city: 'ת"א' }).draft.city).toBe('תל אביב-יפו');
  });

  it('drops a city not in the data instead of guessing', () => {
    expect(v({ city: 'אילת' })).toEqual({
      draft: {},
      dropped: [{ field: 'city', value: 'אילת', reason: 'unknown_city' }],
    });
  });

  it('matches a known neighborhood, tolerating "שכונת" and quote style', () => {
    expect(v({ city: 'חולון', neighborhood: 'שכונת קריית שרת' }).draft.neighborhood).toBe('קריית שרת');
    expect(v({ city: 'גבעתיים', neighborhood: 'גבעת רמב״ם' }).draft.neighborhood).toBe('גבעת רמב"ם');
    expect(v({ city: 'תל אביב-יפו', neighborhood: 'florentin' }).draft.neighborhood).toBe('פלורנטין');
  });

  it('drops a neighborhood that is not in that city', () => {
    // קריית שרת is in Holon, not Givatayim.
    expect(v({ city: 'גבעתיים', neighborhood: 'קריית שרת' }).dropped).toEqual([
      { field: 'neighborhood', value: 'קריית שרת', reason: 'unknown_neighborhood' },
    ]);
  });

  it.each([
    ['rooms', 12],
    ['rooms', 3.7],
    ['rooms', 0],
    ['sizeSqm', 3000],
    ['sizeSqm', 5],
    ['floor', 2.5],
    ['floor', 99],
    ['askingPriceNis', 3.9], // model forgot "million"
    ['askingPriceNis', 18_000], // the CSV's bad row value
    ['askingPriceNis', 60_000_000],
  ] as const)('drops %s = %s as out of range', (field, value) => {
    const res = v({ city: 'חולון', [field]: value });
    expect(res.draft).toEqual({ city: 'חולון' });
    expect(res.dropped).toEqual([{ field, value, reason: 'out_of_range' }]);
  });

  it('rounds a fractional shekel price', () => {
    expect(v({ askingPriceNis: 3_900_000.4 }).draft.askingPriceNis).toBe(3_900_000);
  });

  it.each([
    ['rooms', '4'],
    ['hasElevator', 'כן'],
    ['propertyType', 'castle'],
    ['askingPriceNis', Number.NaN],
  ] as const)('drops %s = %o as invalid type', (field, value) => {
    expect(v({ [field]: value }).dropped).toEqual([{ field, value, reason: 'invalid_type' }]);
  });

  it('ignores null and missing fields', () => {
    expect(v({ city: null, rooms: undefined })).toEqual({ draft: {}, dropped: [] });
  });
});
