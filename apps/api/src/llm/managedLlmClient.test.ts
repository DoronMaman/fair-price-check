import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { config } from '../config.js';
import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { DailyBudget } from '../lib/dailyBudget.js';
import { Metrics } from '../lib/metrics.js';
import { LlmError, unconfiguredLlmClient, type LlmClient } from './LlmClient.js';
import { ManagedLlmClient } from './managedLlmClient.js';

const REQ = { purpose: 'test', system: 's', user: 'u', schema: z.object({}), maxTokens: 10, timeoutMs: 100 };
const ok = { data: {}, usage: { inputTokens: 1_000, outputTokens: 200 }, latencyMs: 300, model: 'm' };

function setup(inner: LlmClient, budgetLimit = 100) {
  const clock = { t: 0 };
  const now = () => clock.t;
  const breaker = new CircuitBreaker({ threshold: 2, openMs: 60_000, now });
  const budget = new DailyBudget({ limit: budgetLimit, today: () => '2026-10-06' });
  const metrics = new Metrics(() => '2026-10-06');
  return { llm: new ManagedLlmClient(inner, { breaker, budget, metrics, now }), breaker, budget, metrics, clock };
}
const mockInner = (impl: () => Promise<unknown>): LlmClient => ({
  model: 'm',
  generateJson: vi.fn(impl) as LlmClient['generateJson'],
});

describe('ManagedLlmClient', () => {
  it('passes through and records tokens, latency and spend', async () => {
    const { llm, metrics } = setup(mockInner(async () => ok));
    await llm.generateJson(REQ);
    const today = metrics.snapshot().llmToday;
    expect(today).toMatchObject({ calls: 1, inputTokens: 1_000, outputTokens: 200 });
    expect(today.estimatedSpendUsd).toBeGreaterThan(0);
  });

  it('opens the circuit after repeated timeouts, then refuses without calling', async () => {
    const inner = mockInner(async () => {
      throw new LlmError('timeout', 't');
    });
    const { llm } = setup(inner);
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'timeout' });
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'timeout' });
    expect(llm.blockedReason()).toBe('circuit_open');
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(inner.generateJson).toHaveBeenCalledTimes(2);
  });

  it('a refusal or bad schema does not trip the breaker (provider is up)', async () => {
    const { llm, breaker } = setup(
      mockInner(async () => {
        throw new LlmError('invalid_output', 'x');
      }),
    );
    for (let i = 0; i < 5; i++) await expect(llm.generateJson(REQ)).rejects.toBeInstanceOf(LlmError);
    expect(breaker.state()).toBe('closed');
  });

  it('stops at the daily budget without calling, and does not waste budget while the circuit is open', async () => {
    const inner = mockInner(async () => ok);
    const { llm, budget, breaker } = setup(inner, 2);
    await llm.generateJson(REQ);
    breaker.recordFailure();
    breaker.recordFailure(); // open
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(budget.snapshot().used).toBe(1);
    breaker.recordSuccess();
    await llm.generateJson(REQ);
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'budget_exhausted' });
    expect(inner.generateJson).toHaveBeenCalledTimes(2);
  });

  it('a rejected key latches the LLM off (no repeated failing calls), reports it, and logs', async () => {
    const inner = mockInner(async () => {
      throw new LlmError('auth_failed', 'invalid x-api-key');
    });
    const { llm, budget, clock } = setup(inner);
    const errors: string[] = [];
    llm.setErrorListener((kind) => errors.push(kind));

    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'auth_failed', sent: true });
    expect(llm.blockedReason()).toBe('auth_failed');
    // Later requests don't hit the provider at all.
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'auth_failed', sent: false });
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'auth_failed', sent: false });
    expect(inner.generateJson).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().used).toBe(1);
    expect(errors).toEqual(['auth_failed']);

    // After the cooldown one call is allowed through, to notice a fixed key.
    clock.t += config.resilience.authFailureCooldownMs;
    expect(llm.blockedReason()).toBeNull();
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'auth_failed', sent: true });
    expect(inner.generateJson).toHaveBeenCalledTimes(2);
  });

  it('a provider 4xx (request rejected) counts toward opening the circuit', async () => {
    const { llm, breaker } = setup(
      mockInner(async () => {
        throw new LlmError('request_rejected', 'credit balance too low');
      }),
    );
    await expect(llm.generateJson(REQ)).rejects.toBeInstanceOf(LlmError);
    await expect(llm.generateJson(REQ)).rejects.toBeInstanceOf(LlmError);
    expect(breaker.state()).toBe('open');
  });

  it('unconfigured → not_configured, no budget used', async () => {
    const { llm, budget } = setup(unconfiguredLlmClient);
    expect(llm.blockedReason()).toBe('not_configured');
    await expect(llm.generateJson(REQ)).rejects.toMatchObject({ kind: 'not_configured', sent: false });
    expect(budget.snapshot().used).toBe(0);
  });
});
