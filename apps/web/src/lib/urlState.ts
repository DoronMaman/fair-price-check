import { LIMITS, PropertyQueryDraftSchema, type PropertyQueryDraft } from '@fpc/shared';

export type Search = { kind: 'text'; text: string } | { kind: 'query'; query: PropertyQueryDraft };

/**
 * The current search lives in the URL *fragment* (#q=… or #query=…), so a link
 * can be shared or reloaded. The fragment is never sent to the server, which
 * keeps users' descriptions out of request logs, proxies and analytics.
 */
export function readSearchFromUrl(location: Pick<Location, 'hash' | 'search'> = window.location): Search | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = hash.get('query');
  if (query) {
    try {
      const parsed = PropertyQueryDraftSchema.safeParse(JSON.parse(query));
      if (parsed.success && parsed.data.city) return { kind: 'query', query: parsed.data };
    } catch {
      // A malformed link is ignored, not an error.
    }
  }
  // #q=… — and legacy ?q=… links, which are moved to the fragment on load.
  const text = hash.get('q') ?? new URLSearchParams(location.search).get('q');
  if (text && text.trim() && text.length <= LIMITS.inputText.maxChars) return { kind: 'text', text: text.trim() };
  return null;
}

/** Replaces the URL (no history entry) with the fragment for this search; drops any ?q=. */
export function writeSearchToUrl(search: Search): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  const hash = new URLSearchParams();
  if (search.kind === 'text') hash.set('q', search.text);
  else hash.set('query', JSON.stringify(search.query));
  url.hash = hash.toString();
  window.history.replaceState(null, '', url);
}
