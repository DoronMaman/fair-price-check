import { useState } from 'react';
import type { AnalyzeResponse, CanonicalCity, Explanation, PropertyQueryDraft, QueryField } from '@fpc/shared';
import { llmNotice } from '../lib/labels';
import { CityPicker } from './CityPicker';
import { ComparablesTable } from './ComparablesTable';
import { ExplanationView } from './ExplanationView';
import { QueryEditor } from './QueryEditor';
import { ResultCard } from './ResultCard';
import { UnderstoodBar } from './UnderstoodBar';

type Props = {
  res: AnalyzeResponse;
  explanation: Explanation | null;
  explaining: boolean;
  onReanalyze: (draft: PropertyQueryDraft) => void;
};

/** Everything below the search form for one analysis. Rendered with a key per analysis, so the editor resets. */
export function Results({ res, explanation, explaining, onReanalyze }: Props) {
  const [editing, setEditing] = useState<{ field?: QueryField | undefined } | null>(null);
  const aiNotice = llmNotice(res.intent?.fallbackReason, explanation?.fallbackReason);

  return (
    <>
      {aiNotice && <p className="rounded-lg bg-stone-200/60 px-3 py-2 text-xs text-stone-700">{aiNotice}</p>}

      <UnderstoodBar
        draft={res.draft}
        intent={res.intent}
        dropped={res.dropped}
        onEdit={(field) => setEditing({ field })}
      />

      {editing && (
        <QueryEditor
          draft={res.draft}
          focusField={editing.field}
          onSubmit={onReanalyze}
          onCancel={() => setEditing(null)}
        />
      )}

      {!res.analysis && (
        <CityPicker
          message={res.intent?.clarificationNeeded ?? 'באיזו עיר נמצא הנכס?'}
          cityAsWritten={res.intent?.cityAsWritten}
          onPick={(city: CanonicalCity) => onReanalyze({ ...res.draft, city })}
        />
      )}

      {res.analysis && (
        <>
          <ResultCard analysis={res.analysis} />
          <ExplanationView explanation={explanation} facts={res.analysis.facts} loading={explaining} />
          <ComparablesTable analysis={res.analysis} />
        </>
      )}
    </>
  );
}
