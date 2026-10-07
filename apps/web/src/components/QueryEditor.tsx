import { useEffect, useId, useRef, useState } from 'react';
import {
  CANONICAL_CITIES,
  LIMITS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS_HE,
  type PropertyQueryDraft,
  type QueryField,
} from '@fpc/shared';
import { FIELD_LABELS } from '../lib/labels';

type Props = {
  draft: PropertyQueryDraft;
  focusField?: QueryField | undefined;
  onSubmit: (draft: PropertyQueryDraft) => void;
  onCancel: () => void;
};

const BOOL_FIELDS = ['hasElevator', 'hasParking', 'hasSafeRoom'] as const;
const NUM_FIELDS = [
  { field: 'rooms', min: LIMITS.rooms.min, max: LIMITS.rooms.max, step: LIMITS.rooms.step },
  { field: 'sizeSqm', min: LIMITS.sizeSqm.min, max: LIMITS.sizeSqm.max, step: 1 },
  { field: 'floor', min: LIMITS.floor.min, max: LIMITS.floor.max, step: 1 },
  { field: 'askingPriceNis', min: LIMITS.priceNis.min, max: LIMITS.priceNis.max, step: 10_000 },
] as const;

const inputClass = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base focus:border-teal-700';

/** Every understood field, editable. The server re-validates whatever is submitted. */
export function QueryEditor({ draft, focusField, onSubmit, onCancel }: Props) {
  const [q, setQ] = useState<PropertyQueryDraft>(draft);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${focusField ?? 'city'}"]`);
    el?.focus();
  }, [focusField]);

  const set = <K extends QueryField>(field: K, value: PropertyQueryDraft[K] | undefined) =>
    setQ((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[field];
      else next[field] = value;
      return next;
    });

  return (
    <form
      ref={formRef}
      aria-label="עריכת פרטי הנכס"
      className="grid grid-cols-1 gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(q);
      }}
    >
      <div>
        <label htmlFor={`${id}-city`} className="mb-1 block text-sm font-medium">
          {FIELD_LABELS.city}
        </label>
        <select
          id={`${id}-city`}
          name="city"
          required
          value={q.city ?? ''}
          onChange={(e) => set('city', (e.target.value || undefined) as PropertyQueryDraft['city'])}
          className={inputClass}
        >
          <option value="">בחרו עיר</option>
          {CANONICAL_CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-nb`} className="mb-1 block text-sm font-medium">
          {FIELD_LABELS.neighborhood} <span className="font-normal text-stone-500">(לא חובה)</span>
        </label>
        <input
          id={`${id}-nb`}
          name="neighborhood"
          value={q.neighborhood ?? ''}
          onChange={(e) => set('neighborhood', e.target.value || undefined)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${id}-type`} className="mb-1 block text-sm font-medium">
          {FIELD_LABELS.propertyType}
        </label>
        <select
          id={`${id}-type`}
          name="propertyType"
          value={q.propertyType ?? ''}
          onChange={(e) => set('propertyType', (e.target.value || undefined) as PropertyQueryDraft['propertyType'])}
          className={inputClass}
        >
          <option value="">לא צוין</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROPERTY_TYPE_LABELS_HE[t]}
            </option>
          ))}
        </select>
      </div>

      {NUM_FIELDS.map(({ field, min, max, step }) => (
        <div key={field}>
          <label htmlFor={`${id}-${field}`} className="mb-1 block text-sm font-medium">
            {FIELD_LABELS[field]}
          </label>
          <input
            id={`${id}-${field}`}
            name={field}
            type="number"
            inputMode="decimal"
            dir="ltr"
            min={min}
            max={max}
            step={step}
            value={q[field] ?? ''}
            onChange={(e) => set(field, e.target.value === '' ? undefined : Number(e.target.value))}
            className={`${inputClass} text-end`}
          />
        </div>
      ))}

      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">מאפיינים</legend>
        <div className="grid grid-cols-3 gap-2">
          {BOOL_FIELDS.map((field) => (
            <div key={field}>
              <label htmlFor={`${id}-${field}`} className="mb-1 block text-xs text-stone-600">
                {FIELD_LABELS[field]}
              </label>
              <select
                id={`${id}-${field}`}
                name={field}
                value={q[field] === undefined ? '' : q[field] ? 'yes' : 'no'}
                onChange={(e) => set(field, e.target.value === '' ? undefined : e.target.value === 'yes')}
                className={inputClass}
              >
                <option value="">לא צוין</option>
                <option value="yes">יש</option>
                <option value="no">אין</option>
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-bold text-white hover:bg-teal-800">
          עדכון החישוב
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-stone-300 px-4 py-2 hover:bg-stone-100"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
