import type { AnalysisResult } from '@fpc/shared';

/**
 * Explanation written by code from the same FactSheet. Uses the same
 * placeholders as the LLM, so it goes through the same renderer — and the
 * tests run every variant through factGuard to prove it passes.
 */
export function buildTemplateParagraphs(a: AnalysisResult): string[] {
  if (a.confidence === 'INSUFFICIENT') {
    return [
      'נמצאו עסקאות דומות מעטות מדי כדי להעריך מחיר באופן אחראי: {{n_comps}} של {{scope_label}}. העסקאות שנמצאו מוצגות בטבלה.',
    ];
  }

  const scope = ['ההשוואה מבוססת על {{n_comps}} של {{scope_label}}, שנרשמו בין {{date_from}} ל{{date_to}}.'];
  if (a.facts.n_outliers_excluded) scope.push('עסקאות במחיר חריג לא נכללו בחישוב ({{n_outliers_excluded}}).');
  if (a.basis === 'price') scope.push('לא צוין שטח, ולכן ההשוואה היא לפי מחיר העסקה הכולל ולא לפי מחיר למ״ר.');
  if (a.confidence === 'LOW') scope.push('ההשוואה רחבה יחסית, ולכן רמת הביטחון בהערכה נמוכה.');

  const range =
    a.basis === 'pricePerSqm'
      ? 'המחיר החציוני למ״ר בעסקאות אלה הוא {{median_ppsqm}}. לפי שטח של {{size_sqm}}, טווח המחירים המשוער לנכס הוא בין {{estimate_low}} ל-{{estimate_high}}, עם חציון של {{estimate_median}}.'
      : 'מחיר העסקה החציוני הוא {{estimate_median}}, והטווח בין הרבעון התחתון לעליון הוא בין {{estimate_low}} ל-{{estimate_high}}.';

  const paragraphs = [scope.join(' '), range];
  if (a.verdict) paragraphs.push(verdictSentence(a.verdict.verdict, a.verdict.askingVsMedian));
  return paragraphs;
}

function verdictSentence(verdict: NonNullable<AnalysisResult['verdict']>['verdict'], askingVsMedian: number): string {
  const nearMedian = Math.round(Math.abs(askingVsMedian) * 100) === 0;
  const vsMedian = nearMedian
    ? 'כמעט זהה לחציון'
    : `{{asking_vs_median_pct}} ${askingVsMedian > 0 ? 'מעל' : 'מתחת'} לחציון`;
  switch (verdict) {
    case 'below_range':
      return `המחיר המבוקש, {{asking_price}}, נמוך מהטווח הזה: {{asking_vs_median_pct}} מתחת לחציון.`;
    case 'above_range':
      return `המחיר המבוקש, {{asking_price}}, גבוה מהטווח הזה: {{asking_vs_median_pct}} מעל לחציון.`;
    case 'within_range':
      return `המחיר המבוקש, {{asking_price}}, נמצא בתוך הטווח: ${vsMedian}.`;
  }
}
