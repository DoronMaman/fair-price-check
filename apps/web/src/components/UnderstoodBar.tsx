import {
  QUERY_FIELDS,
  type DroppedField,
  type IntentResult,
  type PropertyQueryDraft,
  type QueryField,
} from '@fpc/shared';
import { FIELD_LABELS, chipText, describeDropped } from '../lib/labels';

type Props = {
  draft: PropertyQueryDraft;
  intent: IntentResult | null;
  dropped: DroppedField[];
  onEdit: (field?: QueryField) => void;
};

/** "הבנו: גבעתיים · 4 חד׳ · 95 מ״ר · 3.9M ₪" — every chip opens the editor on that field. */
export function UnderstoodBar({ draft, intent, dropped, onEdit }: Props) {
  const chips = QUERY_FIELDS.map((f) => [f, chipText(f, draft)] as const).filter(([, t]) => t !== null);

  return (
    <section aria-label="מה הבנו מהתיאור" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-stone-700">הבנו:</span>
        {chips.length === 0 && <span className="text-sm text-stone-500">לא זוהו פרטים</span>}
        {chips.map(([field, text]) => (
          <button
            key={field}
            type="button"
            onClick={() => onEdit(field)}
            aria-label={`${FIELD_LABELS[field]}: ${text}. לחצו לעריכה`}
            className="rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-900 ring-1 ring-teal-200 hover:bg-teal-100"
          >
            <bdi>{text}</bdi>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onEdit()}
          className="rounded-full px-3 py-1 text-sm text-teal-800 underline underline-offset-2 hover:bg-stone-100"
        >
          עריכה / הוספת פרטים
        </button>
      </div>

      {intent?.source === 'fallback' && (
        <p className="text-xs text-stone-600">זוהה אוטומטית ללא AI — כדאי לוודא שהפרטים נכונים.</p>
      )}
      {dropped.length > 0 && (
        <p className="text-xs text-amber-800">לא השתמשנו ב: {dropped.map(describeDropped).join(' · ')}</p>
      )}
      {intent && intent.unparsed.length > 0 && (
        <p className="text-xs text-stone-600">
          פרטים שלא נכללים בהשוואה: <bdi>{intent.unparsed.join(' · ')}</bdi>
        </p>
      )}
    </section>
  );
}
