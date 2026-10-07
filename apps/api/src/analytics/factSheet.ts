import {
  PROPERTY_TYPE_PLURAL_HE,
  formatDealCount,
  formatDealDate,
  formatNis,
  formatNisPerSqm,
  formatPercent,
  formatRange,
  formatSqm,
  type AnalysisResult,
  type FactId,
  type FactSheet,
} from '@fpc/shared';
import { config } from '../config.js';

const cfg = config.analytics;

export const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** "דירות עם 3.5–4.5 חדרים בפלורנטין, תל אביב-יפו" — built from what was actually filtered on. */
export function scopeLabel(c: AnalysisResult['appliedCriteria']): string {
  const what = c.propertyType ? PROPERTY_TYPE_PLURAL_HE[c.propertyType] : 'נכסים';
  const rooms = c.rooms
    ? c.rooms.min === c.rooms.max
      ? ` עם ${c.rooms.min} חדרים`
      : ` עם ${formatRange(c.rooms.min, c.rooms.max)} חדרים`
    : '';
  const where = c.neighborhood ? `${c.neighborhood}, ${c.city}` : c.city;
  return `${what}${rooms} ב${where}`;
}

type Input = Pick<
  AnalysisResult,
  'query' | 'appliedCriteria' | 'basis' | 'nComps' | 'stats' | 'estimate' | 'verdict' | 'excludedOutliers'
>;

/**
 * Every number the explanation may mention, formatted by code. Only facts that
 * exist for this analysis are included, so an explanation can't reference
 * (say) an estimate when confidence is INSUFFICIENT.
 */
export function buildFactSheet(r: Input): FactSheet {
  const facts: FactSheet = {};
  const put = (id: FactId, value: number | string, formatted: string, description: string) => {
    facts[id] = { value, formatted, description };
  };

  put('city', r.query.city, r.query.city, 'העיר של הנכס');
  put(
    'scope_label',
    scopeLabel(r.appliedCriteria),
    scopeLabel(r.appliedCriteria),
    'אילו עסקאות נחשבו דומות (סוג, חדרים, מיקום)',
  );
  put('n_comps', r.nComps, formatDealCount(r.nComps), 'מספר העסקאות הדומות שעליהן מבוסס החישוב');
  if (r.excludedOutliers.length > 0) {
    put(
      'n_outliers_excluded',
      r.excludedOutliers.length,
      formatDealCount(r.excludedOutliers.length),
      'עסקאות חריגות במחירן שהוצאו מהחישוב',
    );
  }

  const s = r.stats;
  if (!s) return facts; // INSUFFICIENT: no numbers beyond the count

  put('date_from', s.dateFrom, formatDealDate(s.dateFrom, 'month'), 'מועד העסקה המוקדמת ביותר בין הדומות');
  put('date_to', s.dateTo, formatDealDate(s.dateTo, 'month'), 'מועד העסקה המאוחרת ביותר בין הדומות');
  const [y1, y2] = [s.dateFrom.slice(0, 4), s.dateTo.slice(0, 4)];
  put('date_range_years', `${y1}–${y2}`, y1 === y2 ? y1 : formatRange(y1, y2), 'טווח השנים של העסקאות הדומות');

  if (r.basis === 'pricePerSqm') {
    const ppsqm = (n: number) => roundTo(n, cfg.roundPricePerSqmNis);
    put('median_ppsqm', ppsqm(s.median), formatNisPerSqm(ppsqm(s.median)), 'חציון המחיר למ״ר בעסקאות הדומות');
    put('p25_ppsqm', ppsqm(s.p25), formatNisPerSqm(ppsqm(s.p25)), 'הרבעון התחתון של המחיר למ״ר');
    put('p75_ppsqm', ppsqm(s.p75), formatNisPerSqm(ppsqm(s.p75)), 'הרבעון העליון של המחיר למ״ר');
    if (r.query.sizeSqm !== undefined) {
      put('size_sqm', r.query.sizeSqm, formatSqm(r.query.sizeSqm), 'שטח הנכס שנבדק');
    }
  }

  if (r.estimate) {
    // Already rounded in analyze(), so these are exactly the numbers the verdict used.
    const e = r.estimate;
    put('estimate_low', e.low, formatNis(e.low), 'הגבול התחתון של טווח המחירים המשוער לנכס (הרבעון התחתון)');
    put('estimate_median', e.median, formatNis(e.median), 'המחיר החציוני המשוער לנכס');
    put('estimate_high', e.high, formatNis(e.high), 'הגבול העליון של טווח המחירים המשוער לנכס (הרבעון העליון)');
  }

  if (r.query.askingPriceNis !== undefined && r.verdict) {
    put('asking_price', r.query.askingPriceNis, formatNis(r.query.askingPriceNis), 'המחיר המבוקש');
    const pct = Math.abs(r.verdict.askingVsMedian);
    put(
      'asking_vs_median_pct',
      pct,
      formatPercent(pct),
      'הפער באחוזים (ללא סימן) בין המחיר המבוקש למחיר החציוני המשוער; הכיוון נקבע לפי ה-verdict',
    );
  }
  return facts;
}
