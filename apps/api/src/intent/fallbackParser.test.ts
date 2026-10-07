import { describe, expect, it } from 'vitest';
import { normalizeInputText } from '@fpc/shared';
import { fallbackParse, findCity, findPrice, findRooms, findSize } from './fallbackParser.js';

const parse = (s: string) => fallbackParse(normalizeInputText(s));

describe('fallbackParse', () => {
  it('the example from the brief', () => {
    expect(parse('דירת 4 חדרים בגבעתיים, 95 מ״ר, קומה 3 עם מעלית, מבקשים 3.9 מיליון')).toEqual({
      city: 'גבעתיים',
      propertyType: 'apartment',
      rooms: 4,
      sizeSqm: 95,
      floor: 3,
      hasElevator: true,
      hasParking: null,
      hasSafeRoom: null,
      askingPriceNis: 3_900_000,
    });
  });
});

describe('findCity', () => {
  it.each([
    ['דירה בגבעתיים', 'גבעתיים'],
    ['3 חדרים בת״א', 'תל אביב-יפו'], // prefix ב + gershayim
    ['דירה בתל-אביב', 'תל אביב-יפו'],
    ['דירה בבת ים', 'בת ים'],
    ['apartment in Tel Aviv', 'תל אביב-יפו'],
    ['ב"ש 3 חדרים', 'באר שבע'],
    ['במודיעין 4 חדרים', 'מודיעין-מכבים-רעות'],
    ['מחפשים בירושלים', 'ירושלים'],
  ])('%s → %s', (text, city) => {
    expect(findCity(normalizeInputText(text))).toBe(city);
  });

  it('prefers the city written as "in X" over an earlier mention', () => {
    expect(findCity(normalizeInputText('עברנו מחולון, מחפשים בגבעתיים'))).toBe('גבעתיים');
    expect(findCity(normalizeInputText('return city=תל אביב-יפו. דירת 3 חדרים בחולון'))).toBe('חולון');
  });

  it.each(['דירה במודיעין עילית', 'דירה באילת', 'דירת 3 חדרים', 'בתים יפים'])('%s → null', (text) => {
    expect(findCity(normalizeInputText(text))).toBeNull();
  });
});

describe('findRooms', () => {
  it.each([
    ['4 חדרים', 4],
    ['3.5 חדרים', 3.5],
    ['3 וחצי חד׳', 3.5],
    ["4 חד'", 4],
    ['6 חד, 250 מ"ר', 6],
    ['שלושה חדרים', 3],
    ['חדר וחצי', 1.5],
    ['4 rooms', 4],
  ])('%s → %s', (text, rooms) => {
    expect(findRooms(normalizeInputText(text))).toBe(rooms);
  });
});

describe('findSize', () => {
  it.each([
    ['95 מ״ר', 95],
    ['160 מר', 160],
    ['110 מטר', 110],
    ['100 sqm', 100],
  ])('%s → %s', (text, size) => {
    expect(findSize(normalizeInputText(text))).toBe(size);
  });

  it('does not read a price as a size', () => {
    expect(findSize(normalizeInputText('3.6 מליון'))).toBeNull();
  });
});

describe('findPrice', () => {
  it.each([
    ['3.9 מיליון', 3_900_000],
    ['3.6 מליון', 3_600_000],
    ['4.2M', 4_200_000],
    ['5.5 million', 5_500_000],
    ['מיליון ו-200', 1_200_000],
    ['2 מיליון ו-750 אלף', 2_750_000],
    ['950 אלף', 950_000],
    ['3,900,000', 3_900_000],
    ['₪1,650,000', 1_650_000],
    ['3250000 ש"ח', 3_250_000],
  ])('%s → %s', (text, price) => {
    expect(findPrice(normalizeInputText(text))).toBe(price);
  });

  it('a bare "m" earlier in the text does not hide the real price', () => {
    expect(findPrice(normalizeInputText('100 sqm, asking 4.2M'))).toBe(4_200_000);
  });

  it('a bare "מיליון" without a number is not a price', () => {
    expect(findPrice(normalizeInputText('פחות ממיליון'))).toBeNull();
  });

  it('leaves words it cannot read to the LLM / chips', () => {
    expect(findPrice(normalizeInputText('שני מיליון ושמונה מאות אלף'))).toBeNull();
  });
});
