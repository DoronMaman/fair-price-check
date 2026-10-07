// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readSearchFromUrl, writeSearchToUrl } from './urlState';

const loc = (hash: string, search = '') => ({ hash, search });

describe('readSearchFromUrl', () => {
  it('reads text from the fragment', () => {
    expect(readSearchFromUrl(loc('#q=דירה%20בחולון'))).toEqual({ kind: 'text', text: 'דירה בחולון' });
  });

  it('reads an edited query from the fragment', () => {
    const q = encodeURIComponent(JSON.stringify({ city: 'חולון', rooms: 3 }));
    expect(readSearchFromUrl(loc(`#query=${q}`))).toEqual({ kind: 'query', query: { city: 'חולון', rooms: 3 } });
  });

  it('still accepts legacy ?q= links', () => {
    expect(readSearchFromUrl(loc('', '?q=4%20חדרים%20באשדוד'))).toEqual({ kind: 'text', text: '4 חדרים באשדוד' });
  });

  it.each([
    ['malformed JSON', '#query=%7Bnot-json'],
    ['invalid query', `#query=${encodeURIComponent(JSON.stringify({ city: 'אילת' }))}`],
    ['empty text', '#q=%20%20'],
    ['text over the limit', `#q=${'א'.repeat(501)}`],
  ])('ignores %s', (_name, hash) => {
    expect(readSearchFromUrl(loc(hash))).toBeNull();
  });
});

describe('writeSearchToUrl', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?q=old-text-leaks-to-server'));

  it('puts text in the fragment and removes ?q= (the fragment never reaches the server)', () => {
    writeSearchToUrl({ kind: 'text', text: 'דירה בחולון' });
    expect(window.location.search).toBe('');
    expect(readSearchFromUrl(window.location)).toEqual({ kind: 'text', text: 'דירה בחולון' });
  });

  it('round-trips an edited query, so reload/share keeps the edits', () => {
    writeSearchToUrl({ kind: 'query', query: { city: 'חולון', rooms: 3, hasElevator: false } });
    expect(readSearchFromUrl(window.location)).toEqual({
      kind: 'query',
      query: { city: 'חולון', rooms: 3, hasElevator: false },
    });
  });
});
