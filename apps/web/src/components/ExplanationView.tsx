import { useId, useState } from 'react';
import type { Explanation, FactId, FactSheet } from '@fpc/shared';
import { explanationNote } from '../lib/labels';

type Active = { key: string; factId: FactId; text: string } | null;

export function ExplanationView({
  explanation,
  facts,
  loading,
}: {
  explanation: Explanation | null;
  facts: FactSheet;
  loading: boolean;
}) {
  // One source panel for the whole explanation (a disclosure, not a floating tooltip):
  // nothing can overflow the screen edge, and it works the same for mouse, keyboard and touch.
  const [active, setActive] = useState<Active>(null);
  const panelId = useId();

  if (loading && !explanation) {
    return (
      <section
        aria-label="הסבר"
        aria-busy="true"
        className="space-y-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200"
      >
        <p className="text-sm text-stone-500">מנסחים הסבר…</p>
        <div className="h-3 w-11/12 animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-9/12 animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-stone-200" />
      </section>
    );
  }
  if (!explanation) return null;

  const note = explanationNote(explanation.fallbackReason);
  const description = active ? (facts[active.factId]?.description ?? active.factId) : null;

  return (
    <section
      aria-labelledby="explain-title"
      className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="explain-title" className="text-lg font-bold">
          הסבר
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            explanation.source === 'llm' ? 'bg-violet-100 text-violet-900' : 'bg-stone-100 text-stone-700'
          }`}
        >
          {explanation.source === 'llm' ? 'נוסח ע״י AI' : 'נוסח אוטומטי'}
        </span>
      </div>

      {explanation.paragraphs.map((segments, i) => (
        <p key={i} className="leading-loose text-stone-800">
          {segments.map((s, j) => {
            if (s.type === 'text') return <span key={j}>{s.text}</span>;
            const key = `${i}-${j}`;
            const isActive = active?.key === key;
            const show = () => setActive({ key, factId: s.factId, text: s.text });
            return (
              <button
                key={j}
                type="button"
                aria-expanded={isActive}
                aria-controls={panelId}
                // Always "show", never toggle: a tap fires focus *then* click, so a toggle
                // would open and immediately close it on touch screens.
                onClick={show}
                onMouseEnter={show}
                onFocus={show}
                className={`rounded px-1 font-semibold text-teal-950 underline decoration-teal-500 decoration-dotted underline-offset-4 ${
                  isActive ? 'bg-teal-200' : 'bg-teal-100'
                }`}
              >
                <bdi>{s.text}</bdi>
              </button>
            );
          })}
        </p>
      ))}

      <p
        id={panelId}
        aria-live="polite"
        className="min-h-10 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-700"
      >
        {active ? (
          <>
            <bdi className="font-semibold">{active.text}</bdi> — {description}. מחושב ישירות מהעסקאות, לא נכתב ע״י ה-AI.
          </>
        ) : (
          'כל מספר מודגש נלקח מהחישוב ולא נכתב על ידי ה-AI. העבירו את העכבר או הקישו עליו כדי לראות מאיפה הוא.'
        )}
      </p>
      {note && <p className="text-xs text-stone-600">{note}</p>}
    </section>
  );
}
