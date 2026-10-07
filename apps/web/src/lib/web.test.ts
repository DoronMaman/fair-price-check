import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripBidi } from '@fpc/shared';
import { closestCities, rangeLayout } from './geometry';
import { chipText, explanationNote, isLlmUnavailable, llmNotice } from './labels';

describe('rangeLayout', () => {
  const est = { low: 4_460_000, median: 5_010_000, high: 5_880_000 };

  it('keeps band, median and asking inside 0–100 with padding', () => {
    const l = rangeLayout(est, 3_900_000);
    expect(l.asking!).toBeGreaterThan(0);
    expect(l.asking!).toBeLessThan(l.band.start); // below the band
    expect(l.band.start + l.band.width).toBeLessThan(100);
    expect(l.median).toBeGreaterThan(l.band.start);
    expect(l.median).toBeLessThan(l.band.start + l.band.width);
  });

  it('asking above the range sits past the band end', () => {
    const l = rangeLayout(est, 7_000_000);
    expect(l.asking!).toBeGreaterThan(l.band.start + l.band.width);
    expect(l.asking!).toBeLessThan(100);
  });

  it('no asking price → no marker', () => {
    expect(rangeLayout(est).asking).toBeNull();
  });
});

describe('closestCities', () => {
  it.each([
    ['גבעתים', 'גבעתיים'], // typo
    ['רעננא', 'רעננה'],
    ['ירושליים', 'ירושלים'],
    ['tel aviv', 'תל אביב-יפו'],
  ])('%s → %s', (raw, city) => {
    expect(closestCities(raw)[0]).toBe(city);
  });

  it('a real city that is simply not in the data gets no misleading suggestion', () => {
    expect(closestCities('אילת')).toEqual([]);
    expect(closestCities('חדרה')).toEqual([]);
  });
});

describe('chipText', () => {
  const q = {
    city: 'גבעתיים' as const,
    rooms: 4,
    sizeSqm: 95,
    floor: 0,
    hasElevator: false,
    askingPriceNis: 3_900_000,
  };
  it.each([
    ['city', 'גבעתיים'],
    ['rooms', '4 חד׳'],
    ['sizeSqm', '95 מ״ר'],
    ['floor', 'קומת קרקע'],
    ['hasElevator', 'בלי מעלית'],
  ] as const)('%s → %s', (field, text) => {
    expect(chipText(field, q)).toBe(text);
  });

  it('price is compact', () => {
    expect(stripBidi(chipText('askingPriceNis', q)!).replace(/\s+/g, ' ')).toBe('3.9M ₪');
  });

  it('missing fields have no chip', () => {
    expect(chipText('hasParking', q)).toBeNull();
  });
});

describe('LLM-unavailable notices', () => {
  it('infra reasons show the notice; content reasons do not', () => {
    expect(isLlmUnavailable('timeout')).toBe(true);
    expect(isLlmUnavailable('budget_exhausted')).toBe(true);
    expect(isLlmUnavailable('refusal')).toBe(false);
    expect(explanationNote('insufficient_data')).toBeNull();
    expect(explanationNote('guard_failed')).toMatch(/בדיקת העובדות/);
    expect(explanationNote('timeout')).toBeNull(); // shown once, in the page banner
  });

  it('no API key gets a neutral "running without AI" notice, not "unavailable"', () => {
    expect(llmNotice('llm_not_configured', 'llm_not_configured')).toMatch(/פועלת ללא AI/);
    expect(llmNotice('llm_not_configured')).not.toMatch(/אינו זמין/);
  });

  it('a real outage says "currently unavailable", and wins over not-configured', () => {
    expect(llmNotice('timeout', undefined)).toMatch(/אינו זמין כרגע/);
    expect(llmNotice(undefined, 'circuit_open')).toMatch(/אינו זמין כרגע/);
    expect(llmNotice(undefined, 'budget_exhausted')).toMatch(/אינו זמין כרגע/);
  });

  it('no notice when the AI worked or the fallback was content-related', () => {
    expect(llmNotice(undefined, undefined)).toBeNull();
    expect(llmNotice('refusal', 'guard_failed')).toBeNull();
    expect(llmNotice(undefined, 'insufficient_data')).toBeNull();
  });
});

describe('RTL hygiene', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : [],
    );

  // Physical-direction Tailwind utilities break in RTL; use ms/me/ps/pe/start/end.
  const PHYSICAL =
    /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr])-[\w./[\]]+|(?:text|float)-(?:left|right)(?![\w-]))/;

  it.each(files(srcDir).map((f) => [f.slice(srcDir.length + 1), f]))(
    '%s uses only logical direction classes',
    (_name, file) => {
      const classStrings = readFileSync(file, 'utf8').match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? [];
      for (const cls of classStrings) expect(cls).not.toMatch(PHYSICAL);
    },
  );
});
