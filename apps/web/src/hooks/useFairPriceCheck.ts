import { useCallback, useEffect, useReducer, useRef } from 'react';
import { PropertyQuerySchema, type AnalyzeRequest, type AnalyzeResponse, type Explanation } from '@fpc/shared';
import { ApiRequestError, api } from '../lib/api';

export type CheckState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'done';
      /** Increments per analysis, so result-local UI state (e.g. the editor) resets. */
      requestId: number;
      res: AnalyzeResponse;
      explanation: Explanation | null;
      explaining: boolean;
    };

export type CheckAction =
  | { type: 'start' }
  | { type: 'analyzed'; res: AnalyzeResponse }
  | { type: 'explained'; explanation: Explanation }
  | { type: 'explainFailed' }
  | { type: 'failed'; message: string };

let nextRequestId = 1;

/**
 * Pure transitions. The explanation step can only ever *add* to a result on
 * screen — an explanation failure never replaces the numbers with an error.
 */
export function checkReducer(state: CheckState, action: CheckAction): CheckState {
  switch (action.type) {
    case 'start':
      return { phase: 'loading' };
    case 'analyzed':
      return {
        phase: 'done',
        requestId: nextRequestId++,
        res: action.res,
        explanation: action.res.explanation,
        explaining: action.res.explanationPending,
      };
    case 'explained':
      return state.phase === 'done' ? { ...state, explanation: action.explanation, explaining: false } : state;
    case 'explainFailed':
      return state.phase === 'done' ? { ...state, explaining: false } : state;
    case 'failed':
      return { phase: 'error', message: action.message };
  }
}

/**
 * The search lifecycle: analyze (numbers first), then — if needed — explain.
 * Only the latest request may update the screen; a newer search aborts older ones.
 */
export function useFairPriceCheck() {
  const [state, dispatch] = useReducer(checkReducer, { phase: 'idle' });
  const inflight = useRef<AbortController | null>(null);

  // Abort anything in flight when the component goes away.
  useEffect(() => () => inflight.current?.abort(), []);

  const run = useCallback(async (req: AnalyzeRequest) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    dispatch({ type: 'start' });

    let res: AnalyzeResponse;
    try {
      res = await api.analyze(req, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      dispatch({ type: 'failed', message: err instanceof ApiRequestError ? err.message : 'משהו השתבש. נסו שוב.' });
      return;
    }
    if (ctrl.signal.aborted) return;
    dispatch({ type: 'analyzed', res });
    if (!res.explanationPending) return;

    // The explanation is optional: any failure here keeps the numbers on screen.
    try {
      const query = PropertyQuerySchema.safeParse(res.draft);
      if (!query.success) throw new Error('draft is not a complete query');
      const { explanation } = await api.explain({ query: query.data }, ctrl.signal);
      if (!ctrl.signal.aborted) dispatch({ type: 'explained', explanation });
    } catch {
      if (!ctrl.signal.aborted) dispatch({ type: 'explainFailed' });
    }
  }, []);

  return { state, run };
}
