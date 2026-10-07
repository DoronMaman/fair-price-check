import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS, normalizeInputText } from '@fpc/shared';
import { fallbackParse } from './fallbackParser.js';
import { factGuard } from '../explain/factGuard.js';
import { loadDataset } from '../data/loadDataset.js';
import { knownNeighborhoodsOf, validateIntent } from './validateIntent.js';
import { parseDealDate, parsePrice, parseRooms } from '../data/parsers.js';

// Property-based tests: arbitrary (including hostile) input must never crash a
// parser or let an out-of-range value through validation.

const ctx = { knownNeighborhoods: knownNeighborhoodsOf(loadDataset({ today: '2026-10-06' }).deals) };
const hebrewish = fc.string({
  unit: fc.constantFrom(...'אבגדהוזחטיכלמנסעפצקרשת 0123456789.,״׳"\'-₪מליוןאלףחדריםמ״רM'.split('')),
  maxLength: LIMITS.inputText.maxChars,
});
const anyText = fc.oneof(hebrewish, fc.string({ maxLength: LIMITS.inputText.maxChars }));

describe('fallback parser + validation (fuzz)', () => {
  it('never throws, and validated output is always within the declared limits', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const { draft } = validateIntent(fallbackParse(normalizeInputText(text)), ctx);
        if (draft.rooms !== undefined) {
          expect(draft.rooms).toBeGreaterThanOrEqual(LIMITS.rooms.min);
          expect(draft.rooms).toBeLessThanOrEqual(LIMITS.rooms.max);
          expect(Number.isInteger(draft.rooms * 2)).toBe(true);
        }
        if (draft.sizeSqm !== undefined) {
          expect(draft.sizeSqm).toBeGreaterThanOrEqual(LIMITS.sizeSqm.min);
          expect(draft.sizeSqm).toBeLessThanOrEqual(LIMITS.sizeSqm.max);
        }
        if (draft.askingPriceNis !== undefined) {
          expect(Number.isInteger(draft.askingPriceNis)).toBe(true);
          expect(draft.askingPriceNis).toBeGreaterThanOrEqual(LIMITS.priceNis.min);
          expect(draft.askingPriceNis).toBeLessThanOrEqual(LIMITS.priceNis.max);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('validation accepts only well-typed, in-range values from arbitrary LLM-like output', () => {
    fc.assert(
      fc.property(
        fc.record({
          city: fc.oneof(fc.string(), fc.constant('חולון'), fc.constant(null)),
          rooms: fc.oneof(fc.double(), fc.integer(), fc.string(), fc.constant(null)),
          sizeSqm: fc.oneof(fc.double(), fc.constant(null)),
          askingPriceNis: fc.oneof(fc.double(), fc.integer(), fc.constant(null)),
          hasElevator: fc.oneof(fc.boolean(), fc.string(), fc.constant(null)),
        }),
        (candidate) => {
          const { draft, dropped } = validateIntent(candidate, ctx);
          for (const [k, v] of Object.entries(draft)) {
            expect(v).not.toBeNull();
            expect(Number.isNaN(v)).toBe(false);
            expect(k in candidate).toBe(true);
          }
          // Every present field is either accepted or reported as dropped — never silently lost.
          const present = Object.entries(candidate).filter(([, v]) => v !== null && v !== undefined).length;
          expect(Object.keys(draft).length + dropped.length).toBe(present);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('CSV field parsers (fuzz)', () => {
  it('never throw on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parsePrice(s);
        parseRooms(s);
        parseDealDate(s, '2026-10-06');
      }),
      { numRuns: 1_000 },
    );
  });

  it('a parsed date is a real calendar date and never in the future', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        (s, d) => {
          const today = d.toISOString().slice(0, 10);
          const r = parseDealDate(s, today);
          if (r.ok) {
            expect(r.value.date <= today).toBe(true);
            expect(new Date(`${r.value.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(r.value.date);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe('fact guard (fuzz)', () => {
  it('never accepts text that contains a digit outside placeholders', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 9 }), (s, digit) => {
        const res = factGuard([`ההשוואה ${s}${digit}`], { facts: {}, verdict: null });
        expect(res.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});
