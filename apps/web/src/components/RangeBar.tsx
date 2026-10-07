import type { AnalysisResult, Verdict } from '@fpc/shared';
import { webConfig } from '../config';
import { rangeLayout } from '../lib/geometry';

const MARKER_COLOR: Record<Verdict, string> = {
  below_range: 'bg-sky-700',
  within_range: 'bg-emerald-700',
  above_range: 'bg-rose-700',
};

const { min: CLAMP_MIN, max: CLAMP_MAX } = webConfig.rangeLabelClampPct;
const clamp = (n: number) => Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, n));

/**
 * p25–p75 band, median tick, asking-price marker. Low prices at inline-start
 * (right, in RTL), labelled at both ends so direction is never ambiguous.
 * Positions use logical inset (insetInlineStart), never left/right.
 */
export function RangeBar({ analysis }: { analysis: AnalysisResult }) {
  const { estimate, verdict, facts, query } = analysis;
  if (!estimate) return null;
  const layout = rangeLayout(estimate, query.askingPriceNis);
  const f = (id: keyof typeof facts) => facts[id]?.formatted ?? '';

  const summary = `טווח עסקאות דומות בין ${f('estimate_low')} ל-${f('estimate_high')}, חציון ${f('estimate_median')}${
    verdict ? `. המחיר המבוקש ${f('asking_price')}` : ''
  }`;

  return (
    <figure className="space-y-2" aria-label={summary}>
      {/* Asking-price label above its marker */}
      <div className="relative h-7" aria-hidden="true">
        {layout.asking !== null && verdict && (
          <span
            className="absolute top-0 whitespace-nowrap rounded bg-stone-900 px-2 py-0.5 text-xs font-bold text-white"
            // Centered on the marker. RTL: inline-start is the right edge, so shift by +50%.
            style={{ insetInlineStart: `${clamp(layout.asking)}%`, transform: 'translateX(50%)' }}
          >
            מבוקש: <bdi>{f('asking_price')}</bdi>
          </span>
        )}
      </div>

      <div className="relative h-4 rounded-full bg-stone-200" aria-hidden="true">
        <div
          className="absolute inset-y-0 rounded-full bg-teal-300"
          style={{ insetInlineStart: `${layout.band.start}%`, width: `${layout.band.width}%` }}
        />
        <div className="absolute -inset-y-1 w-0.5 bg-teal-900" style={{ insetInlineStart: `${layout.median}%` }} />
        {layout.asking !== null && verdict && (
          <div
            className={`absolute -inset-y-2 w-1.5 rounded-full ${MARKER_COLOR[verdict.verdict]}`}
            style={{ insetInlineStart: `${layout.asking}%` }}
          />
        )}
      </div>

      <div className="flex justify-between text-xs text-stone-600" aria-hidden="true">
        <span>נמוך</span>
        <span>גבוה</span>
      </div>

      <figcaption className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <div className="text-xs text-stone-500">רבעון תחתון</div>
          <bdi className="font-semibold">{f('estimate_low')}</bdi>
        </div>
        <div>
          <div className="text-xs text-stone-500">חציון</div>
          <bdi className="font-bold text-teal-900">{f('estimate_median')}</bdi>
        </div>
        <div>
          <div className="text-xs text-stone-500">רבעון עליון</div>
          <bdi className="font-semibold">{f('estimate_high')}</bdi>
        </div>
      </figcaption>
    </figure>
  );
}
