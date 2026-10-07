// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { readSearchFromUrl } from './lib/urlState';
import analyzeFixture from './test/fixtures/analyze-givatayim.json';
import noCityFixture from './test/fixtures/analyze-no-city.json';
import explainFixture from './test/fixtures/explain-givatayim.json';

// Fixtures are real /api responses captured from the running server (template mode).
const pending = { ...analyzeFixture, explanation: null, explanationPending: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Route = (url: string, body: unknown) => Response | Promise<Response>;
function mockFetch(route: Route) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body: unknown = JSON.parse(init.body as string);
      calls.push({ url, body });
      return route(url, body);
    }),
  );
  return calls;
}

async function submit(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/תארו את הנכס/), text);
  await user.click(screen.getByRole('button', { name: 'בדיקת מחיר' }));
}

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the numbers first, then the explanation', async () => {
    let releaseExplain!: () => void;
    const explainGate = new Promise<void>((r) => (releaseExplain = r));
    mockFetch(async (url) => {
      if (url === '/api/analyze') return json(pending);
      await explainGate;
      return json(explainFixture);
    });
    render(<App />);
    await submit('דירה בגבעתיים');

    expect(await screen.findByText('המחיר המבוקש נמוך מטווח העסקאות הדומות')).toBeTruthy();
    expect(screen.getByText('מנסחים הסבר…')).toBeTruthy(); // numbers are on screen, explanation still loading
    act(() => releaseExplain());
    expect(await screen.findByText('נוסח אוטומטי')).toBeTruthy();
    expect(screen.queryByText('מנסחים הסבר…')).toBeNull();
  });

  it('keeps the numbers when the explanation request fails', async () => {
    mockFetch((url) => (url === '/api/analyze' ? json(pending) : json({ error: 'internal', message: 'x' }, 500)));
    render(<App />);
    await submit('דירה בגבעתיים');
    expect(await screen.findByText('המחיר המבוקש נמוך מטווח העסקאות הדומות')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('מנסחים הסבר…')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('העסקאות הדומות ביותר')).toBeTruthy();
  });

  it('shows the server’s Hebrew message on 429', async () => {
    mockFetch(() => json({ error: 'rate_limited', message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' }, 429));
    render(<App />);
    await submit('דירה');
    expect((await screen.findByRole('alert')).textContent).toContain('יותר מדי בקשות');
  });

  it('asks for the city when none was understood, and picking one re-analyzes', async () => {
    const calls = mockFetch((_url, body) => json((body as { query?: unknown }).query ? analyzeFixture : noCityFixture));
    render(<App />);
    await submit('דירת 3 חדרים');
    expect(await screen.findByText('באיזו עיר נמצא הנכס?')).toBeTruthy();
    await userEvent.setup().selectOptions(screen.getByLabelText('הערים שיש לנו עליהן נתונים:'), 'חולון');
    await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ query: { city: 'חולון', rooms: 3 } }));
  });

  it('writes the search to the URL fragment, not the query string', async () => {
    mockFetch(() => json(analyzeFixture));
    render(<App />);
    await submit('דירה בגבעתיים');
    await screen.findByText('המחיר המבוקש נמוך מטווח העסקאות הדומות');
    expect(window.location.search).toBe('');
    expect(readSearchFromUrl(window.location)).toEqual({ kind: 'text', text: 'דירה בגבעתיים' });
  });

  it('runs a search from a shared link on load', async () => {
    window.history.replaceState(null, '', `/#q=${encodeURIComponent('דירה בגבעתיים')}`);
    const calls = mockFetch(() => json(analyzeFixture));
    render(<App />);
    expect(await screen.findByText('המחיר המבוקש נמוך מטווח העסקאות הדומות')).toBeTruthy();
    expect(calls[0]!.body).toEqual({ text: 'דירה בגבעתיים' });
  });

  it('a newer search wins: a late explanation for an older search is ignored', async () => {
    let releaseOldExplain!: () => void;
    const oldExplainGate = new Promise<void>((r) => (releaseOldExplain = r));
    mockFetch(async (url, body) => {
      if (url === '/api/explain') {
        await oldExplainGate; // the first search's explanation is slow
        return json(explainFixture);
      }
      return json((body as { text: string }).text.includes('ראשון') ? pending : noCityFixture);
    });
    render(<App />);
    await submit('חיפוש ראשון');
    expect(await screen.findByText('מנסחים הסבר…')).toBeTruthy();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/תארו את הנכס/));
    await submit('חיפוש שני');
    expect(await screen.findByText('באיזו עיר נמצא הנכס?')).toBeTruthy();

    act(() => releaseOldExplain());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('באיזו עיר נמצא הנכס?')).toBeTruthy();
    expect(screen.queryByText('נוסח אוטומטי')).toBeNull();
  });

  it('a highlighted number reveals which fact it came from', async () => {
    mockFetch(() => json(analyzeFixture));
    render(<App />);
    await submit('דירה בגבעתיים');
    const button = (await screen.findAllByRole('button', { expanded: false })).find((b) =>
      b.textContent?.includes('3,900,000'),
    )!;
    await userEvent.setup().click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)!.textContent).toContain('המחיר המבוקש');
  });
});
