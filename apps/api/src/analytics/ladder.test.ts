import { describe, expect, it } from 'vitest';
import { levelsFor, matches } from './ladder.js';
import { loadDataset } from '../data/loadDataset.js';

const deals = loadDataset({ today: '2026-10-06' }).deals;
const deal = (id: string) => deals.find((d) => d.dealId === id)!;

describe('levelsFor', () => {
  it('a full query gets all four levels', () => {
    const levels = levelsFor({ city: 'חולון', neighborhood: 'קריית שרת', propertyType: 'apartment', rooms: 3 });
    expect(levels.map((l) => l.scope)).toEqual(['neighborhood', 'city_type_rooms', 'city_rooms', 'city']);
  });

  it('skips the neighborhood level without a neighborhood', () => {
    const levels = levelsFor({ city: 'חולון', propertyType: 'apartment', rooms: 3 });
    expect(levels.map((l) => l.scope)).toEqual(['city_type_rooms', 'city_rooms', 'city']);
  });

  it('a city-only query has only the city level (no misleading "type" label)', () => {
    expect(levelsFor({ city: 'חולון' }).map((l) => l.scope)).toEqual(['city']);
  });

  it('collapses levels whose filters are identical, keeping the broader name', () => {
    // No type: city_type_rooms (rooms ±0.5) still differs from city_rooms (±1).
    expect(levelsFor({ city: 'חולון', rooms: 3 }).map((l) => l.scope)).toEqual([
      'city_type_rooms',
      'city_rooms',
      'city',
    ]);
    // Type but no rooms: city_type_rooms differs from city; city_rooms equals city.
    expect(levelsFor({ city: 'חולון', propertyType: 'duplex' }).map((l) => l.scope)).toEqual([
      'city_type_rooms',
      'city',
    ]);
  });

  it('clamps the rooms window to the valid range', () => {
    const [first] = levelsFor({ city: 'חולון', rooms: 1 });
    expect(first!.criteria.rooms).toEqual({ min: 1, max: 1.5 });
  });

  it('normalizes the query neighborhood like the CSV ("מרכז " → "מרכז")', () => {
    const [first] = levelsFor({ city: 'בית שמש', neighborhood: ' מרכז  ' });
    expect(first!.criteria.neighborhood).toBe('מרכז');
  });
});

describe('matches', () => {
  it('neighborhood identity is (city, neighborhood): בית שמש/מרכז ≠ נתניה/מרכז', () => {
    // D100477 is בית שמש / מרכז.
    expect(matches(deal('D100477'), { city: 'בית שמש', neighborhood: 'מרכז' })).toBe(true);
    expect(matches(deal('D100477'), { city: 'נתניה', neighborhood: 'מרכז' })).toBe(false);
  });

  it('a deal with unknown rooms never matches a rooms filter', () => {
    const d = { ...deal('D100477'), rooms: null };
    expect(matches(d, { city: 'בית שמש', rooms: { min: 1, max: 10 } })).toBe(false);
    expect(matches(d, { city: 'בית שמש' })).toBe(true);
  });
});
