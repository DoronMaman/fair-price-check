import {
  PROPERTY_TYPE_LABELS_HE,
  formatNisCompact,
  type Confidence,
  type DroppedField,
  type ExplanationFallbackReason,
  type PropertyQueryDraft,
  type QueryField,
  type Verdict,
} from '@fpc/shared';

export const FIELD_LABELS: Record<QueryField, string> = {
  city: 'עיר',
  neighborhood: 'שכונה',
  propertyType: 'סוג נכס',
  rooms: 'חדרים',
  sizeSqm: 'שטח (מ״ר)',
  floor: 'קומה',
  hasElevator: 'מעלית',
  hasParking: 'חניה',
  hasSafeRoom: 'ממ״ד',
  askingPriceNis: 'מחיר מבוקש (₪)',
};

export const CONFIDENCE_LABELS: Record<Confidence, { text: string; className: string; hint: string }> = {
  HIGH: {
    text: 'ביטחון גבוה',
    className: 'bg-emerald-100 text-emerald-900',
    hint: 'הרבה עסקאות דומות מאותו סוג ובאותו גודל',
  },
  MEDIUM: { text: 'ביטחון בינוני', className: 'bg-amber-100 text-amber-900', hint: 'מספר סביר של עסקאות דומות' },
  LOW: {
    text: 'ביטחון נמוך',
    className: 'bg-orange-100 text-orange-900',
    hint: 'ההשוואה רחבה — התייחסו לטווח בזהירות',
  },
  INSUFFICIENT: {
    text: 'אין מספיק נתונים',
    className: 'bg-stone-200 text-stone-800',
    hint: 'מעט מדי עסקאות דומות להערכה',
  },
};

export const VERDICT_HEADLINES: Record<Verdict | 'none', string> = {
  below_range: 'המחיר המבוקש נמוך מטווח העסקאות הדומות',
  within_range: 'המחיר המבוקש בתוך טווח העסקאות הדומות',
  above_range: 'המחיר המבוקש גבוה מטווח העסקאות הדומות',
  none: 'טווח המחירים לנכסים דומים',
};

/** Fallback reasons that mean the AI service failed or was cut off right now (an outage). */
const OUTAGE: ReadonlySet<string> = new Set([
  'llm_auth_failed',
  'timeout',
  'rate_limited',
  'unavailable',
  'circuit_open',
  'budget_exhausted',
]);

export const isLlmUnavailable = (reason: string | undefined) =>
  reason !== undefined && (reason === 'llm_not_configured' || OUTAGE.has(reason));

/**
 * Page-level notice about the AI. No API key is a deliberate mode, not a failure,
 * so it gets a neutral message; "currently unavailable" is only for real outages.
 */
export function llmNotice(...reasons: (string | undefined)[]): string | null {
  if (reasons.some((r) => r !== undefined && OUTAGE.has(r))) {
    return 'שירות ה-AI אינו זמין כרגע. הזיהוי וההסבר נעשים אוטומטית — כל המספרים מחושבים מהנתונים ומוצגים במלואם.';
  }
  if (reasons.includes('llm_not_configured')) {
    return 'המערכת פועלת ללא AI: זיהוי הפרטים וניסוח ההסבר נעשים אוטומטית. כל המספרים מחושבים מהנתונים ומוצגים במלואם.';
  }
  return null;
}

/** Note under the explanation. "AI unavailable" is shown once, in the page banner, not here. */
export function explanationNote(reason: ExplanationFallbackReason | undefined): string | null {
  if (reason === 'guard_failed') return 'הניסוח של ה-AI לא עבר את בדיקת העובדות, לכן מוצג נוסח אוטומטי.';
  return null;
}

const DROP_REASONS: Record<DroppedField['reason'], string> = {
  invalid_type: 'ערך לא תקין',
  unknown_city: 'עיר שאין לנו עליה נתונים',
  unknown_neighborhood: 'שכונה שלא מופיעה בנתונים של העיר',
  out_of_range: 'מחוץ לטווח הסביר',
};
export const describeDropped = (d: DroppedField) =>
  `${FIELD_LABELS[d.field]} (${String(d.value)}): ${DROP_REASONS[d.reason]}`;

const yesNo = (v: boolean, yes: string, no: string) => (v ? yes : no);

/** Short chip text per field, e.g. "4 חד׳", "95 מ״ר", "3.9M ₪". */
export function chipText(field: QueryField, q: PropertyQueryDraft): string | null {
  switch (field) {
    case 'city':
      return q.city ?? null;
    case 'neighborhood':
      return q.neighborhood ?? null;
    case 'propertyType':
      return q.propertyType ? PROPERTY_TYPE_LABELS_HE[q.propertyType] : null;
    case 'rooms':
      return q.rooms !== undefined ? `${q.rooms} חד׳` : null;
    case 'sizeSqm':
      return q.sizeSqm !== undefined ? `${q.sizeSqm} מ״ר` : null;
    case 'floor':
      return q.floor !== undefined ? (q.floor === 0 ? 'קומת קרקע' : `קומה ${q.floor}`) : null;
    case 'hasElevator':
      return q.hasElevator !== undefined ? yesNo(q.hasElevator, 'מעלית', 'בלי מעלית') : null;
    case 'hasParking':
      return q.hasParking !== undefined ? yesNo(q.hasParking, 'חניה', 'בלי חניה') : null;
    case 'hasSafeRoom':
      return q.hasSafeRoom !== undefined ? yesNo(q.hasSafeRoom, 'ממ״ד', 'בלי ממ״ד') : null;
    case 'askingPriceNis':
      return q.askingPriceNis !== undefined ? formatNisCompact(q.askingPriceNis) : null;
  }
}
