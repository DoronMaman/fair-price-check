import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Results } from './components/Results';
import { SearchForm } from './components/SearchForm';
import { useFairPriceCheck } from './hooks/useFairPriceCheck';
import { readSearchFromUrl, writeSearchToUrl, type Search } from './lib/urlState';

export function App() {
  const { state, run } = useFairPriceCheck();
  // Read once on mount: a shared link or a reload.
  const [initial] = useState(readSearchFromUrl);

  const search = useCallback(
    (s: Search) => {
      writeSearchToUrl(s); // shareable, reload-safe, never sent to the server
      void run(s.kind === 'text' ? { text: s.text } : { query: s.query });
    },
    [run],
  );

  // A search in the URL (shared link or reload) runs once on load.
  useEffect(() => {
    if (initial) search(initial);
  }, [initial, search]);

  const initialText = initial?.kind === 'text' ? initial.text : '';

  return (
    <div className="min-h-screen bg-stone-100 font-sans text-stone-900">
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold sm:text-3xl">בדיקת מחיר הוגן</h1>
          <p className="text-stone-600">
            השוו מחיר מבוקש לעסקאות דומות שנרשמו בפועל — ותראו בדיוק על אילו עסקאות ההשוואה מבוססת.
          </p>
        </header>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <SearchForm
            busy={state.phase === 'loading'}
            initialText={initialText}
            onSubmit={(text) => search({ kind: 'text', text })}
          />
        </div>

        {/* Results region: announced to screen readers when it changes. */}
        <div aria-live="polite" aria-busy={state.phase === 'loading'} className="space-y-5">
          {state.phase === 'loading' && (
            <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
              <p className="text-sm text-stone-500">מחפשים עסקאות דומות…</p>
              <div className="h-6 w-2/3 animate-pulse rounded bg-stone-200" />
              <div className="h-4 w-full animate-pulse rounded-full bg-stone-200" />
            </div>
          )}

          {state.phase === 'error' && (
            <div role="alert" className="rounded-2xl bg-rose-50 p-4 text-rose-900 ring-1 ring-rose-200">
              {state.message}
            </div>
          )}

          <ErrorBoundary resetKey={state.phase === 'done' ? state.requestId : state.phase}>
            {state.phase === 'done' && (
              <Results
                key={state.requestId}
                res={state.res}
                explanation={state.explanation}
                explaining={state.explaining}
                onReanalyze={(query) => search({ kind: 'query', query })}
              />
            )}
          </ErrorBoundary>
        </div>

        <footer className="space-y-1 border-t border-stone-200 pt-4 text-xs text-stone-500">
          <p>
            ההשוואה מבוססת רק על עסקאות שנרשמו במאגר. היא אינה הערכת שמאי ואינה ייעוץ. שכונה, רחוב ומגמות מחיר אינם
            נכללים בה.
          </p>
          <p>
            <a className="underline" href="/api/data-quality" target="_blank" rel="noreferrer">
              על הנתונים ואיך ניקינו אותם
            </a>
            {state.phase === 'done' && (
              <>
                {' · '}גרסת נתונים <bdi className="font-mono">{state.res.dataVersion}</bdi>
              </>
            )}
          </p>
        </footer>
      </main>
    </div>
  );
}
