import type { AnalysisResult } from '@fpc/shared';
import { CONFIDENCE_LABELS, VERDICT_HEADLINES } from '../lib/labels';
import { RangeBar } from './RangeBar';

export function ResultCard({ analysis }: { analysis: AnalysisResult }) {
  const { facts, verdict, confidence } = analysis;
  const conf = CONFIDENCE_LABELS[confidence];
  const f = (id: keyof typeof facts) => facts[id]?.formatted;

  if (confidence === 'INSUFFICIENT') {
    return (
      <section
        aria-labelledby="result-title"
        className="space-y-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200"
      >
        <h2 id="result-title" className="text-xl font-bold">
          אין מספיק עסקאות דומות כדי להעריך — הנה מה שיש
        </h2>
        <p className="text-stone-700">
          נמצאו <bdi>{f('n_comps')}</bdi> של <bdi>{f('scope_label')}</bdi>. העסקאות מוצגות בטבלה למטה.
        </p>
      </section>
    );
  }

  const direction = verdict
    ? verdict.verdict === 'within_range'
      ? null
      : `${f('asking_vs_median_pct')} ${verdict.askingVsMedian > 0 ? 'מעל' : 'מתחת'} לחציון`
    : null;

  return (
    <section
      aria-labelledby="result-title"
      className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="result-title" className="text-xl font-bold leading-snug">
          {VERDICT_HEADLINES[verdict?.verdict ?? 'none']}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${conf.className}`} title={conf.hint}>
          {conf.text}
        </span>
      </div>
      {direction && (
        <p className="text-lg">
          <bdi className="font-bold">{direction}</bdi>
        </p>
      )}

      <RangeBar analysis={analysis} />

      <p className="text-sm text-stone-600">
        מבוסס על <bdi>{f('n_comps')}</bdi> של <bdi>{f('scope_label')}</bdi>
        {facts.date_range_years && (
          <>
            , <bdi>{f('date_range_years')}</bdi>
          </>
        )}
        {analysis.basis === 'price' && ' · לפי מחיר עסקה כולל (לא צוין שטח)'}
        {facts.median_ppsqm && (
          <>
            {' '}
            · חציון למ״ר <bdi>{f('median_ppsqm')}</bdi>
          </>
        )}
      </p>
      <p className="text-xs text-stone-500">{conf.hint}</p>
    </section>
  );
}
