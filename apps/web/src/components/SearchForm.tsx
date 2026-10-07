import { useId, useState } from 'react';
import { LIMITS } from '@fpc/shared';

const EXAMPLES = [
  'דירת 4 חדרים בגבעתיים, 95 מ״ר, קומה 3 עם מעלית, מבקשים 3.9 מיליון',
  '3 וחצי חד׳ בת״א, 80 מ״ר, 4.2M',
  'דירה בקריית שרת בחולון, 4 חדרים, 2.9 מיליון',
];

export function SearchForm({
  busy,
  initialText = '',
  onSubmit,
}: {
  busy: boolean;
  initialText?: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const id = useId();
  const max = LIMITS.inputText.maxChars;
  const submit = (t: string) => {
    const v = t.trim();
    if (v && !busy) onSubmit(v);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
    >
      <label htmlFor={id} className="block text-base font-medium text-stone-800">
        תארו את הנכס שאתם בודקים, במילים שלכם
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(text);
        }}
        maxLength={max}
        rows={3}
        aria-describedby={`${id}-hint`}
        placeholder="לדוגמה: דירת 4 חדרים בגבעתיים, 95 מ״ר, מבקשים 3.9 מיליון"
        className="w-full resize-y rounded-xl border border-stone-300 bg-white p-3 text-base leading-relaxed shadow-sm placeholder:text-stone-400 focus:border-teal-700"
      />
      <div id={`${id}-hint`} className="flex justify-between text-xs text-stone-500">
        <span>עיר, חדרים, שטח ומחיר מבוקש — מה שידוע לכם</span>
        <span aria-live="polite">
          <bdi>
            {text.length}/{max}
          </bdi>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-stone-600">דוגמאות:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy}
            onClick={() => {
              setText(ex);
              submit(ex);
            }}
            className="max-w-full truncate rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {busy ? 'בודקים…' : 'בדיקת מחיר'}
      </button>
    </form>
  );
}
