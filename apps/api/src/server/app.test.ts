import { describe, expect, it, vi } from 'vitest';
import {
  AnalyzeResponseSchema,
  DataQualityReportSchema,
  ExplainResponseSchema,
  type AnalyzeResponse,
} from '@fpc/shared';
import { loadDataset } from '../data/loadDataset.js';
import type { ExplanationLlmOutput } from '../explain/prompt.js';
import type { IntentLlmOutput } from '../intent/prompt.js';
import { LlmError, unconfiguredLlmClient, type LlmClient, type LlmJsonRequest } from '../llm/LlmClient.js';
import { createContext } from '../orchestrator/context.js';
import { analyze } from '../analytics/analyze.js';
import { answerCacheKey } from '../orchestrator/explanationService.js';
import { canonicalQueryJson } from '../orchestrator/pipeline.js';
import { stripBidi } from '@fpc/shared';
import { buildApp } from './app.js';

const dataset = loadDataset({ today: '2026-10-06' });
const NOW = Date.parse('2026-10-06T09:00:00Z');
const EXAMPLE = 'דירת 4 חדרים בגבעתיים, 95 מ״ר, קומה 3 עם מעלית, מבקשים 3.9 מיליון';
const QUERY = { city: 'גבעתיים', propertyType: 'apartment', rooms: 4, sizeSqm: 95, askingPriceNis: 3_900_000 };

const INTENT_OUT: IntentLlmOutput = {
  city: 'גבעתיים',
  cityAsWritten: null,
  neighborhood: null,
  propertyType: 'apartment',
  rooms: 4,
  sizeSqm: 95,
  floor: 3,
  hasElevator: true,
  hasParking: null,
  hasSafeRoom: null,
  askingPriceNis: 3_900_000,
  unparsed: [],
  clarificationNeeded: null,
};
const EXPLAIN_OUT: ExplanationLlmOutput = {
  paragraphs: [
    'ההשוואה מבוססת על {{n_comps}} של {{scope_label}}.',
    'המחיר המבוקש, {{asking_price}}, נמוך מהטווח: {{asking_vs_median_pct}} מתחת לחציון.',
  ],
  usedFactIds: ['n_comps', 'scope_label', 'asking_price', 'asking_vs_median_pct'],
};

/** Answers by purpose; counts calls per purpose. */
function mockLlm(behavior: 'ok' | 'timeout' = 'ok') {
  const calls: string[] = [];
  const llm: LlmClient = {
    model: 'mock',
    generateJson: vi.fn(async (req: LlmJsonRequest<unknown>) => {
      calls.push(req.purpose);
      if (behavior === 'timeout') throw new LlmError('timeout', 'slow');
      const data = req.purpose === 'intent' ? INTENT_OUT : EXPLAIN_OUT;
      return { data, usage: { inputTokens: 1_000, outputTokens: 150 }, latencyMs: 400, model: 'mock' };
    }) as LlmClient['generateJson'],
  };
  return { llm, calls };
}

async function appWith(
  llm: LlmClient,
  opts: { perIpPerMinute?: number; dailyLlmCallBudget?: number; metricsToken?: string; logger?: object } = {},
) {
  const ctx = createContext({
    dataset,
    llm,
    now: () => NOW,
    ...(opts.dailyLlmCallBudget !== undefined ? { dailyLlmCallBudget: opts.dailyLlmCallBudget } : {}),
  });
  const app = await buildApp(ctx, {
    logger: opts.logger ?? false,
    perIpPerMinute: opts.perIpPerMinute ?? 1_000,
    metricsToken: opts.metricsToken,
  });
  const post = async (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  const analyze = async (payload: unknown) => {
    const res = await post('/api/analyze', payload);
    return { status: res.statusCode, body: res.json<AnalyzeResponse>() };
  };
  return { app, ctx, post, analyze };
}

describe('acceptance: no LLM_API_KEY → whole app works in template mode', () => {
  it('free text → parsed chips, stats, template explanation, in one response', async () => {
    const { analyze } = await appWith(unconfiguredLlmClient);
    const { status, body } = await analyze({ text: EXAMPLE });
    expect(status).toBe(200);
    AnalyzeResponseSchema.parse(body);
    expect(body.intent).toMatchObject({ source: 'fallback', fallbackReason: 'llm_not_configured' });
    expect(body.draft).toMatchObject(QUERY);
    expect(body.analysis!.verdict!.verdict).toBe('below_range');
    expect(body.analysis!.comparables.length).toBeGreaterThan(0);
    expect(body.explanation).toMatchObject({ source: 'template', fallbackReason: 'llm_not_configured' });
    expect(body.explanationPending).toBe(false);
  });

  it('edited chips (query) → analysis + template', async () => {
    const { analyze } = await appWith(unconfiguredLlmClient);
    const { body } = await analyze({ query: { ...QUERY, rooms: 3 } });
    expect(body.intent).toBeNull();
    expect(body.analysis!.query.rooms).toBe(3);
    expect(body.explanation!.source).toBe('template');
  });

  it('/api/explain answers with the template', async () => {
    const { post } = await appWith(unconfiguredLlmClient);
    const res = await post('/api/explain', { query: QUERY });
    expect(res.statusCode).toBe(200);
    expect(ExplainResponseSchema.parse(res.json()).explanation.source).toBe('template');
  });

  it('health, metrics and data-quality respond', async () => {
    const { app } = await appWith(unconfiguredLlmClient);
    const health = (await app.inject('/api/health')).json();
    expect(health).toMatchObject({ status: 'ok', deals: 518, llm: { configured: false, mode: 'template' } });
    DataQualityReportSchema.parse((await app.inject('/api/data-quality')).json());
  });
});

describe('two-step flow with a working LLM', () => {
  it('analyze → pending; explain → LLM explanation; repeat → both caches hit', async () => {
    const { llm, calls } = mockLlm();
    const { analyze, post, ctx } = await appWith(llm);

    const first = await analyze({ text: EXAMPLE });
    expect(first.body.intent!.source).toBe('llm');
    expect(first.body.explanationPending).toBe(true);
    expect(first.body.explanation).toBeNull();
    expect(first.body.analysis).not.toBeNull(); // stats never wait on the explanation

    const exp = (await post('/api/explain', { query: first.body.draft })).json();
    expect(exp.explanation.source).toBe('llm');
    expect(calls).toEqual(['intent', 'explain']);

    // Same text, different spacing/quote style → same normalized text → cache hits, no new calls.
    const second = await analyze({ text: `  ${EXAMPLE.replace('״', '"')} ` });
    expect(second.body.intent!.source).toBe('llm');
    expect(second.body.explanationPending).toBe(false);
    expect(second.body.explanation!.source).toBe('llm');
    expect(calls).toEqual(['intent', 'explain']);

    const m = ctx.metrics.snapshot();
    expect(m.intent).toMatchObject({ cacheHit: 1, cacheMiss: 1 });
    expect(m.explain).toMatchObject({ cacheHit: 1, cacheMiss: 1 });
  });
});

describe('resilience', () => {
  it('LLM timing out → templates; after N failures the circuit opens and the LLM is skipped', async () => {
    const { llm, calls } = mockLlm('timeout');
    const { analyze, app } = await appWith(llm);
    for (let i = 0; i < 5; i++) {
      const { status, body } = await analyze({ text: `${EXAMPLE} ${i}` });
      expect(status).toBe(200);
      expect(body.intent!.fallbackReason).toBe('timeout');
    }
    expect((await app.inject('/api/health')).json().llm.circuit).toBe('open');

    const { body } = await analyze({ text: EXAMPLE });
    expect(body.intent!.fallbackReason).toBe('circuit_open');
    expect(body.explanation).toMatchObject({ source: 'template', fallbackReason: 'circuit_open' });
    expect(calls).toHaveLength(5);
  });

  it('daily LLM budget exhausted → templates, never an error', async () => {
    const { llm, calls } = mockLlm();
    const { analyze } = await appWith(llm, { dailyLlmCallBudget: 1 });
    await analyze({ text: EXAMPLE }); // uses the 1 call
    const { status, body } = await analyze({ text: 'דירה בחולון 3 חדרים' });
    expect(status).toBe(200);
    expect(body.intent!.fallbackReason).toBe('budget_exhausted');
    expect(body.explanation).toMatchObject({ source: 'template', fallbackReason: 'budget_exhausted' });
    expect(calls).toHaveLength(1);
  });

  it('per-IP rate limit → 429 with a Hebrew message', async () => {
    const { analyze } = await appWith(unconfiguredLlmClient, { perIpPerMinute: 2 });
    await analyze({ text: EXAMPLE });
    await analyze({ text: EXAMPLE });
    const third = await analyze({ text: EXAMPLE });
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: 'rate_limited' });
  });
});

describe('request validation', () => {
  it.each([
    ['empty text', { text: '   ' }],
    ['text over 500 chars', { text: 'א'.repeat(501) }],
    ['unknown field', { text: 'דירה', admin: true }],
    ['both text and query', { text: 'דירה', query: {} }],
    ['out-of-range query', { query: { city: 'חולון', rooms: 40 } }],
  ])('400 for %s', async (_name, payload) => {
    const { post } = await appWith(unconfiguredLlmClient);
    const res = await post('/api/analyze', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('text without a city → no analysis, a clarification question', async () => {
    const { analyze } = await appWith(unconfiguredLlmClient);
    const { status, body } = await analyze({ text: 'דירת 3 חדרים 2.1 מיליון' });
    expect(status).toBe(200);
    expect(body.analysis).toBeNull();
    expect(body.intent!.clarificationNeeded).toBeTruthy();
  });

  it('an edited query with an unknown neighborhood drops it and still analyzes', async () => {
    const { analyze } = await appWith(unconfiguredLlmClient);
    const { body } = await analyze({ query: { city: 'חולון', neighborhood: 'לא קיימת' } });
    expect(body.dropped).toEqual([{ field: 'neighborhood', value: 'לא קיימת', reason: 'unknown_neighborhood' }]);
    expect(body.analysis!.scope).toBe('city');
  });
});

describe('cache keys', () => {
  it('canonical query JSON ignores key order and missing-vs-undefined', () => {
    expect(canonicalQueryJson({ rooms: 4, city: 'חולון' })).toBe(
      canonicalQueryJson({ city: 'חולון', rooms: 4, sizeSqm: undefined }),
    );
    expect(canonicalQueryJson({ city: 'חולון', rooms: 4 })).not.toBe(canonicalQueryJson({ city: 'חולון', rooms: 4.5 }));
  });

  const analysisFor = (q: Record<string, unknown>) =>
    analyze({ ...(QUERY as object), ...q } as never, dataset, { today: '2026-10-06' });

  it('the answer key depends on what the model sees, not on values: asking ±1 ₪ shares an entry', () => {
    expect(answerCacheKey(analysisFor({ askingPriceNis: 3_900_000 }), 'm')).toBe(
      answerCacheKey(analysisFor({ askingPriceNis: 3_900_001 }), 'm'),
    );
  });

  it('a different verdict, fact set or model gets a different entry', () => {
    const below = analysisFor({ askingPriceNis: 3_900_000 });
    expect(answerCacheKey(below, 'm')).not.toBe(answerCacheKey(analysisFor({ askingPriceNis: 9_000_000 }), 'm')); // above
    expect(answerCacheKey(below, 'm')).not.toBe(answerCacheKey(analysisFor({ askingPriceNis: undefined }), 'm')); // no asking
    expect(answerCacheKey(below, 'm')).not.toBe(answerCacheKey(below, 'other-model'));
  });
});

describe('explanation cache cannot be bypassed', () => {
  it('varying the asking price does not force new LLM calls, and each user still sees their own number', async () => {
    const { llm, calls } = mockLlm();
    const { post } = await appWith(llm);
    const first = (await post('/api/explain', { query: { ...QUERY, askingPriceNis: 3_900_000 } })).json();
    const second = (await post('/api/explain', { query: { ...QUERY, askingPriceNis: 3_900_001 } })).json();
    expect(calls).toEqual(['explain']);
    const text = (r: { explanation: { paragraphs: { text: string }[][] } }) =>
      stripBidi(
        r.explanation.paragraphs
          .flat()
          .map((x) => x.text)
          .join(''),
      );
    expect(text(first)).toContain('3,900,000');
    expect(text(second)).toContain('3,900,001');
    expect(second.explanation.source).toBe('llm');
  });
});

describe('serving the built frontend', () => {
  it('serves index.html for / and SPA paths, keeps /api 404s as JSON', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="he" dir="rtl"></html>');
    const ctx = createContext({ dataset, llm: unconfiguredLlmClient, now: () => NOW });
    const app = await buildApp(ctx, { logger: false, webDist: dir });

    const root = await app.inject('/');
    expect(root.statusCode).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
    expect(root.body).toContain('dir="rtl"');
    expect((await app.inject('/?q=%D7%93%D7%99%D7%A8%D7%94')).body).toContain('dir="rtl"');
    expect((await app.inject('/some/deep/link')).body).toContain('dir="rtl"');

    const api404 = await app.inject('/api/nope');
    expect(api404.statusCode).toBe(404);
    expect(api404.json()).toMatchObject({ error: 'not_found' });
    expect((await app.inject('/api/health')).json().status).toBe('ok');
  });
});

describe('operational endpoints and logging', () => {
  const TOKEN = 'test-metrics-token-0123456789';

  it('/api/metrics is disabled without a token, 401 with a wrong one, 200 with the right one', async () => {
    expect((await (await appWith(unconfiguredLlmClient)).app.inject('/api/metrics')).statusCode).toBe(404);
    const { app } = await appWith(unconfiguredLlmClient, { metricsToken: TOKEN });
    expect((await app.inject('/api/metrics')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/metrics', headers: { authorization: 'Bearer wrong-token-0123456789' } }))
        .statusCode,
    ).toBe(401);
    const ok = await app.inject({ url: '/api/metrics', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty('llmToday');
  });

  it('request logs never contain the query string (search text) or the analyzed text', async () => {
    const lines: string[] = [];
    const stream = { write: (l: string) => lines.push(l) };
    const { app, post } = await appWith(unconfiguredLlmClient, { logger: { level: 'info', stream } });
    await app.inject('/?q=SECRET-USER-TEXT');
    await post('/api/analyze', { text: 'דירה בחולון SECRET-BODY-TEXT' });
    const all = lines.join('\n');
    expect(all).toContain('"url":"/"');
    expect(all).not.toContain('SECRET');
  });

  it('a provider auth failure is logged at error level and health reports degraded', async () => {
    const lines: string[] = [];
    const llm: LlmClient = {
      model: 'mock',
      generateJson: vi.fn(async () => {
        throw new LlmError('auth_failed', 'invalid x-api-key');
      }),
    };
    const { app, analyze } = await appWith(llm, {
      logger: { level: 'info', stream: { write: (l: string) => lines.push(l) } },
    });
    const { body } = await analyze({ text: EXAMPLE });
    expect(body.intent!.fallbackReason).toBe('llm_auth_failed');
    expect(body.explanation).toMatchObject({ source: 'template', fallbackReason: 'llm_auth_failed' });
    expect(lines.some((l) => l.includes('"level":50') && l.includes('LLM key rejected'))).toBe(true);
    expect((await app.inject('/api/health')).json().llm).toMatchObject({
      mode: 'degraded',
      blockedReason: 'auth_failed',
    });
  });

  it('the request abort signal is passed to every LLM call', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const llm: LlmClient = {
      model: 'mock',
      generateJson: vi.fn(async (req: LlmJsonRequest<unknown>) => {
        signals.push(req.signal);
        return {
          data: req.purpose === 'intent' ? INTENT_OUT : EXPLAIN_OUT,
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
          model: 'mock',
        };
      }) as LlmClient['generateJson'],
    };
    const { ctx } = await appWith(llm);
    const ctrl = new AbortController();
    const { handleAnalyze, handleExplain } = await import('../orchestrator/pipeline.js');
    const { response } = await handleAnalyze({ text: EXAMPLE }, ctx, { signal: ctrl.signal });
    await handleExplain({ query: response.analysis!.query }, ctx, { signal: ctrl.signal });
    expect(signals).toEqual([ctrl.signal, ctrl.signal]);
  });
});
