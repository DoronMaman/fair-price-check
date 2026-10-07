import { describe, expect, it } from 'vitest';
import { normalizeDataset, normalizeRow, resolveConflicts } from './normalize.js';
import {
  parseDayFirstDate,
  parseDealDate,
  parseIsoDate,
  parseMonthYear,
  parsePrice,
  parseRooms,
  parseTriState,
  type RawRow,
} from './parsers.js';
import { ALL_RAW_ROWS, realRow, realRows } from './testFixtures.js';

const TODAY = '2026-10-06';

function dealOf(raw: RawRow, today = TODAY) {
  const res = normalizeRow(raw, today);
  if (!res.ok) throw new Error(`expected ${raw.deal_id} to normalize, got ${res.reason}`);
  return res.deal;
}

function rowWithDate(date: string): RawRow {
  const row = ALL_RAW_ROWS.find((r) => r.deal_date === date);
  if (!row) throw new Error(`no row dated ${date}`);
  return row;
}

describe('deal_id duplicates', () => {
  it('drops exact duplicates (D100311 appears twice, identical)', () => {
    const rows = realRows('D100311');
    expect(rows).toHaveLength(2);
    const { deals, report } = normalizeDataset(rows, { today: TODAY, dataVersion: 't' });
    expect(deals).toHaveLength(1);
    expect(report.duplicates.exactDropped).toBe(1);
  });

  it('prefers רשות המסים over מתווך on conflicting prices (D100017)', () => {
    const { deals, conflicts } = resolveConflicts(realRows('D100017').map((r) => dealOf(r)));
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ source: 'tax_authority', priceNis: 1_919_000 });
    expect(conflicts).toEqual([
      {
        dealId: 'D100017',
        kept: { source: 'tax_authority', priceNis: 1_919_000 },
        dropped: [{ source: 'broker', priceNis: 1_851_548 }],
      },
    ]);
  });

  it('prefers מתווך over בעל נכס even when the owner row comes first (D100032)', () => {
    const rows = realRows('D100032');
    expect(rows[0]!.source).toBe('בעל נכס');
    const { deals } = resolveConflicts(rows.map((r) => dealOf(r)));
    expect(deals[0]).toMatchObject({ source: 'broker', priceNis: 5_343_137 });
  });
});

describe('city', () => {
  it.each([
    ['D100117', 'תל אביב-יפו'], // ת"א
    ['D100380', 'תל אביב-יפו'], // Tel Aviv-Yafo
    ['D100030', 'באר שבע'], // ב"ש
    ['D100008', 'ירושלים'], // "ירושלים " with trailing space
    ['D100447', 'מודיעין-מכבים-רעות'], // מודיעין
    ['D100477', 'בית שמש'], // בית-שמש
  ])('%s resolves to %s', (id, city) => {
    expect(dealOf(realRow(id)).city).toBe(city);
  });

  it('rejects a row whose city is not in the alias table, never guessing', () => {
    const res = normalizeRow({ ...realRow('D100117'), city: 'אילת' }, TODAY);
    expect(res).toEqual({ ok: false, reason: 'unknown_city', rawValue: 'אילת' });
  });
});

describe('neighborhood', () => {
  it('trims whitespace ("מרכז " in D100477)', () => {
    expect(realRow('D100477').neighborhood).toBe('מרכז ');
    expect(dealOf(realRow('D100477')).neighborhood).toBe('מרכז');
  });

  it('keeps an empty neighborhood as null (D100469)', () => {
    expect(dealOf(realRow('D100469')).neighborhood).toBeNull();
  });

  it.each([
    ['D100495', 'פלורנטין'], // "Florentin"
    ['D100198', "רמת בית שמש א'"], // 'רמב"ש א\''
  ])('resolves neighborhood spelling variants (%s → %s)', (id, canonical) => {
    expect(dealOf(realRow(id)).neighborhood).toBe(canonical);
  });

  it('does not merge "מרכז" with "מרכז העיר" (not provably the same area)', () => {
    const { deals } = normalizeDataset(ALL_RAW_ROWS, { today: TODAY, dataVersion: 't' });
    const netanya = new Set(deals.filter((d) => d.city === 'נתניה').map((d) => d.neighborhood));
    expect(netanya.has('מרכז')).toBe(true);
    expect(netanya.has('מרכז העיר')).toBe(true);
  });

  it('"מרכז" exists in several cities, so identity must be (city, neighborhood)', () => {
    const { deals } = normalizeDataset(ALL_RAW_ROWS, { today: TODAY, dataVersion: 't' });
    const cities = new Set(deals.filter((d) => d.neighborhood === 'מרכז').map((d) => d.city));
    expect(cities.size).toBeGreaterThan(5);
  });
});

describe('property_type and condition', () => {
  it('trims padded property type ("  דירה " in D100312)', () => {
    expect(dealOf(realRow('D100312')).propertyType).toBe('apartment');
  });

  it('trims padded condition ("  שמור " in D100032)', () => {
    expect(dealOf(realRows('D100032')[0]!).condition).toBe('maintained');
  });

  it('keeps a missing condition as null (D100023)', () => {
    expect(dealOf(realRow('D100023')).condition).toBeNull();
  });

  it('rejects an unknown property type', () => {
    const res = normalizeRow({ ...realRow('D100312'), property_type: 'מחסן' }, TODAY);
    expect(res.ok).toBe(false);
  });
});

describe('rooms', () => {
  it('parses "2 חדרים" (D100479)', () => {
    expect(realRow('D100479').rooms).toBe('2 חדרים');
    expect(dealOf(realRow('D100479')).rooms).toBe(2);
  });

  it.each([
    ['4', 4],
    ['3.5', 3.5],
    ['5.5 חדרים', 5.5],
  ])('parses %s', (raw, value) => {
    expect(parseRooms(raw).value).toBe(value);
  });

  it.each(['3.7', '0', '11', 'שלושה'])('treats %s as invalid → null (row kept)', (raw) => {
    expect(parseRooms(raw)).toMatchObject({ value: null, invalid: true });
  });
});

describe('price_nis', () => {
  it('strips commas ("4,331,000" in D100477)', () => {
    expect(dealOf(realRow('D100477')).priceNis).toBe(4_331_000);
  });

  it('strips the ₪ prefix ("₪1,884,000" in D100417)', () => {
    expect(realRow('D100417').price_nis).toBe('₪1,884,000');
    expect(dealOf(realRow('D100417')).priceNis).toBe(1_884_000);
  });

  it.each([
    ['D100251', '0'],
    ['D100317', '18000'],
  ])('rejects %s with price %s as below the minimum', (id, raw) => {
    expect(normalizeRow(realRow(id), TODAY)).toEqual({ ok: false, reason: 'price_below_min', rawValue: raw });
  });

  it('returns null for text that is not a price', () => {
    expect(parsePrice('3.9 מיליון').value).toBeNull();
  });

  it('flags the 38.5M (D100001) and 44M (D100193) deals as outliers but keeps them', () => {
    const { deals } = normalizeDataset(ALL_RAW_ROWS, { today: TODAY, dataVersion: 't' });
    for (const id of ['D100001', 'D100193']) {
      expect(deals.find((d) => d.dealId === id)).toMatchObject({ isOutlier: true });
    }
  });
});

describe('size_sqm', () => {
  it('keeps a deal without size, with ₪/m² = null (D100223)', () => {
    const deal = dealOf(realRow('D100223'));
    expect(deal).toMatchObject({ sizeSqm: null, pricePerSqm: null, priceNis: 9_114_000 });
  });
});

describe('price_per_sqm', () => {
  it('ignores the CSV column and recomputes (D100178: CSV 68,592, actual 3,586,000 / 65)', () => {
    const row = realRow('D100178');
    expect(row.price_per_sqm).toBe('68592');
    expect(dealOf(row).pricePerSqm).toBeCloseTo(3_586_000 / 65, 6);
  });
});

describe('has_* booleans', () => {
  it.each([
    ['כן', true],
    ['yes', true],
    ['TRUE', true],
    ['1', true],
    ['לא', false],
    ['no', false],
    ['FALSE', false],
    ['0', false],
    ['', null],
  ])('%s → %s', (raw, value) => {
    expect(parseTriState(raw)).toBe(value);
  });

  it('mixed spellings in one row (D100479: yes / 1 / 1 / כן)', () => {
    expect(dealOf(realRow('D100479'))).toMatchObject({
      hasElevator: true,
      hasParking: true,
      hasBalcony: true,
      hasSafeRoom: true,
    });
  });

  it('missing has_parking is unknown (null), not "no" (D100311)', () => {
    expect(dealOf(realRow('D100311')).hasParking).toBeNull();
  });
});

describe('deal_date', () => {
  it('ISO 2026-02-12 parses to Feb 12, not Dec 2 (D100257)', () => {
    expect(realRow('D100257').deal_date).toBe('2026-02-12');
    expect(dealOf(realRow('D100257'))).toMatchObject({ dealDate: '2026-02-12', datePrecision: 'day' });
  });

  it('the day-first parser refuses ISO strings rather than misreading them', () => {
    expect(parseDayFirstDate('2026-02-12', '.')).toBeNull();
    expect(parseDayFirstDate('2026-02-12', '/')).toBeNull();
  });

  it('dot format is day-first ("17.07.2026")', () => {
    expect(dealOf(rowWithDate('17.07.2026')).dealDate).toBe('2026-07-17');
  });

  it('slash format is day-first ("15/06/2025")', () => {
    expect(dealOf(rowWithDate('15/06/2025')).dealDate).toBe('2025-06-15');
  });

  it('ambiguous "03/02/2026" (D100023) is read day-first → Feb 3', () => {
    expect(parseDayFirstDate('03/02/2026', '/')).toMatchObject({ date: '2026-02-03', ambiguous: true });
    expect(dealOf(realRow('D100023')).dealDate).toBe('2026-02-03');
  });

  it('"Aug 2025" → first of month, month precision', () => {
    expect(dealOf(rowWithDate('Aug 2025'))).toMatchObject({ dealDate: '2025-08-01', datePrecision: 'month' });
  });

  it('each parser only accepts its own format', () => {
    expect(parseIsoDate('17.07.2026')).toBeNull();
    expect(parseMonthYear('2025-09-07')).toBeNull();
    expect(parseDayFirstDate('31.02.2025', '.')).toBeNull(); // not a calendar date
  });

  it('rejects dates after today', () => {
    // D100257 is 2026-02-12; pretend today is the day before.
    expect(normalizeRow(realRow('D100257'), '2026-02-11')).toMatchObject({ ok: false, reason: 'date_in_future' });
    expect(parseDealDate('2026-02-12', '2026-02-12').ok).toBe(true);
  });
});

describe('condition vs year_built', () => {
  it('keeps both fields as-is when "חדש מקבלן" was built in 1985 (D100301)', () => {
    expect(dealOf(realRow('D100301'))).toMatchObject({ condition: 'new_from_contractor', yearBuilt: 1985 });
  });
});

describe('year_built', () => {
  it('missing year is null (D100407)', () => {
    expect(dealOf(realRow('D100407')).yearBuilt).toBeNull();
  });
});

describe('street', () => {
  it('is not carried into NormalizedDeal, so it cannot be matched on or quoted', () => {
    expect(dealOf(realRow('D100477'))).not.toHaveProperty('street');
  });
});
