import { describe, expect, it } from 'vitest';
import { CANONICAL_CITIES, CITY_ALIASES, canonicalCity } from './cityAliases.js';

describe('canonicalCity', () => {
  // All 29 raw spellings that appear in the CSV.
  it.each([
    ['ת"א', 'תל אביב-יפו'],
    ['תל אביב', 'תל אביב-יפו'],
    ['תל אביב יפו', 'תל אביב-יפו'],
    ['תל אביב-יפו', 'תל אביב-יפו'],
    ['Tel Aviv-Yafo', 'תל אביב-יפו'],
    ['ב"ש', 'באר שבע'],
    ['באר-שבע', 'באר שבע'],
    ['באר שבע', 'באר שבע'],
    ['Jerusalem', 'ירושלים'],
    ['ירושלים', 'ירושלים'],
    ['ירושלים ', 'ירושלים'],
    ['בית-שמש', 'בית שמש'],
    ['בית שמש', 'בית שמש'],
    ['מודיעין', 'מודיעין-מכבים-רעות'],
    ['מודיעין מכבים רעות', 'מודיעין-מכבים-רעות'],
    ['מודיעין-מכבים-רעות', 'מודיעין-מכבים-רעות'],
    ['חולון', 'חולון'],
    ['נתניה', 'נתניה'],
    ['ראשון לציון', 'ראשון לציון'],
    ['פתח תקווה', 'פתח תקווה'],
    ['כפר סבא', 'כפר סבא'],
    ['רעננה', 'רעננה'],
    ['רמת גן', 'רמת גן'],
    ['רחובות', 'רחובות'],
    ['הרצליה', 'הרצליה'],
    ['גבעתיים', 'גבעתיים'],
    ['בת ים', 'בת ים'],
    ['אשדוד', 'אשדוד'],
    ['חיפה', 'חיפה'],
  ])('%s → %s', (raw, expected) => {
    expect(canonicalCity(raw)).toBe(expected);
  });

  it('unifies Hebrew gershayim and curly quotes with ASCII quotes', () => {
    expect(canonicalCity('ת״א')).toBe('תל אביב-יפו'); // U+05F4
    expect(canonicalCity('ת“א')).toBe('תל אביב-יפו');
    expect(canonicalCity('ב״ש')).toBe('באר שבע');
  });

  it('is case-insensitive for Latin names', () => {
    expect(canonicalCity('tel aviv-yafo')).toBe('תל אביב-יפו');
    expect(canonicalCity('JERUSALEM')).toBe('ירושלים');
  });

  it('returns null for unknown cities instead of guessing', () => {
    expect(canonicalCity('אילת')).toBeNull(); // real city, not in the data
    expect(canonicalCity('מודיעין עילית')).toBeNull(); // different city from מודיעין
    expect(canonicalCity('תל')).toBeNull();
    expect(canonicalCity('')).toBeNull();
    expect(canonicalCity(null)).toBeNull();
  });

  it('every alias points to a canonical city', () => {
    for (const city of Object.values(CITY_ALIASES)) expect(CANONICAL_CITIES).toContain(city);
  });
});
