import { describe, expect, it } from 'vitest';
import { FACT_IDS, stripBidi } from '@fpc/shared';
import { loadDataset } from '../data/loadDataset.js';
import { analyze } from './analyze.js';
import { scopeLabel } from './factSheet.js';

const TODAY = '2026-10-06';
const ds = loadDataset({ today: TODAY });
const r = analyze(
  { city: 'גבעתיים', propertyType: 'apartment', rooms: 4, sizeSqm: 95, askingPriceNis: 3_900_000 },
  ds,
  { today: TODAY },
);
// Intl output has RLM marks and a no-break space before ₪; compare on plain text.
const plain = (s: string) => stripBidi(s).replace(/\u00A0/g, ' ');
const f = (id: keyof typeof r.facts) => plain(r.facts[id]!.formatted);

describe('buildFactSheet', () => {
  it('formats ₪ amounts with Intl he-IL', () => {
    expect(f('asking_price')).toBe('3,900,000 ₪');
    expect(f('estimate_median')).toMatch(/^\d{1,3}(,\d{3})+ ₪$/);
  });

  it('formats ₪/m², size, counts and percent', () => {
    expect(f('median_ppsqm')).toMatch(/^\d{1,3}(,\d{3})* ₪ למ״ר$/);
    expect(f('size_sqm')).toBe('95 מ״ר');
    expect(f('n_comps')).toBe('8 עסקאות');
    expect(f('asking_vs_median_pct')).toMatch(/^\d+%$/);
  });

  it('the percentage fact has no sign; direction comes from the verdict enum', () => {
    expect(r.verdict!.askingVsMedian).toBeLessThan(0);
    expect(r.facts.asking_vs_median_pct!.value).toBeGreaterThan(0);
  });

  it('estimate facts are the exact numbers the verdict used', () => {
    expect(r.facts.estimate_low!.value).toBe(r.estimate!.low);
    expect(r.facts.estimate_high!.value).toBe(r.estimate!.high);
  });

  it('every fact has a Hebrew description and a known id', () => {
    for (const [id, fact] of Object.entries(r.facts)) {
      expect(FACT_IDS).toContain(id);
      expect(fact.description).toMatch(/[֐-׿]/);
    }
  });

  it('"עסקה אחת" for a single deal', () => {
    const one = analyze({ city: 'גבעתיים' }, ds, { today: TODAY });
    expect(plain(one.facts.n_outliers_excluded!.formatted)).toBe('עסקה אחת');
  });
});

describe('scopeLabel', () => {
  it('isolates the rooms range so RTL text cannot flip it to "4.5–3.5"', () => {
    expect(scopeLabel({ city: 'גבעתיים', rooms: { min: 3.5, max: 4.5 } })).toContain('\u20663.5–4.5\u2069');
  });

  it.each([
    [{ city: 'גבעתיים' as const }, 'נכסים בגבעתיים'],
    [
      { city: 'גבעתיים' as const, propertyType: 'apartment' as const, rooms: { min: 3.5, max: 4.5 } },
      'דירות עם 3.5–4.5 חדרים בגבעתיים',
    ],
    [{ city: 'חולון' as const, neighborhood: 'קריית שרת' }, 'נכסים בקריית שרת, חולון'],
  ])('%o → %s', (criteria, label) => {
    expect(stripBidi(scopeLabel(criteria))).toBe(label);
  });
});
