import { useId } from 'react';
import { CANONICAL_CITIES, type CanonicalCity } from '@fpc/shared';
import { closestCities } from '../lib/geometry';

type Props = {
  message: string;
  cityAsWritten?: string | undefined;
  onPick: (city: CanonicalCity) => void;
};

/** Missing or unknown city: suggest close spellings, and always offer the full list. */
export function CityPicker({ message, cityAsWritten, onPick }: Props) {
  const id = useId();
  const suggestions = cityAsWritten ? closestCities(cityAsWritten) : [];

  return (
    <section aria-label="בחירת עיר" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-medium text-amber-950">{message}</p>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">אולי התכוונתם ל:</span>
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              className="rounded-full bg-white px-3 py-1 text-sm font-medium ring-1 ring-amber-300 hover:bg-amber-100"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm">
          הערים שיש לנו עליהן נתונים:
        </label>
        <select
          id={id}
          defaultValue=""
          onChange={(e) => e.target.value && onPick(e.target.value as CanonicalCity)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2"
        >
          <option value="">בחרו עיר</option>
          {CANONICAL_CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
