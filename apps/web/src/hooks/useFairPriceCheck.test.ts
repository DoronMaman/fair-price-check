import { describe, expect, it } from 'vitest';
import { AnalyzeResponseSchema } from '@fpc/shared';
import fixture from '../test/fixtures/analyze-givatayim.json';
import { checkReducer, type CheckState } from './useFairPriceCheck';

const res = AnalyzeResponseSchema.parse({ ...fixture, explanation: null, explanationPending: true });
const done = checkReducer({ phase: 'loading' }, { type: 'analyzed', res }) as Extract<CheckState, { phase: 'done' }>;

describe('checkReducer', () => {
  it('analyzed → done, explaining while the explanation is pending', () => {
    expect(done).toMatchObject({ phase: 'done', explaining: true, explanation: null });
  });

  it('an explanation failure keeps the numbers on screen', () => {
    const next = checkReducer(done, { type: 'explainFailed' });
    expect(next).toMatchObject({ phase: 'done', explaining: false, res });
  });

  it('an explanation arriving after a new search started is ignored', () => {
    const loading = checkReducer(done, { type: 'start' });
    const explanation = AnalyzeResponseSchema.parse(fixture).explanation!;
    expect(checkReducer(loading, { type: 'explained', explanation })).toEqual({ phase: 'loading' });
  });

  it('each analysis gets a new requestId (so per-result UI state resets)', () => {
    const again = checkReducer({ phase: 'loading' }, { type: 'analyzed', res }) as Extract<
      CheckState,
      { phase: 'done' }
    >;
    expect(again.requestId).not.toBe(done.requestId);
  });
});
