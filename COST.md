# Cost

Designed for 10,000 checks/day on a personal budget. Short version: the
statistics are free (in-memory, milliseconds); the only paid component is two
small LLM calls per _uncached_ check, and a hard daily call budget caps the
worst case no matter what traffic does.

## What costs money

| Step                                                | Paid?   | Notes                                                                                                                                             |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalization, matching, stats, verdict, formatting | No      | Deterministic code over 518 in-memory deals; a few ms per request.                                                                                |
| LLM call #1 — intent extraction                     | Yes     | Once per distinct input text (cached 7 days by normalized text + prompt version).                                                                 |
| LLM call #2 — explanation                           | Yes     | Once per distinct _model input_ (verdict, confidence, scope, basis, fact ids — never values), cached 24h; one retry if the fact guard rejects it. |
| Chip edits (`{query}` requests)                     | Only #2 | No intent call.                                                                                                                                   |
| `INSUFFICIENT` confidence                           | No      | The LLM is not called; the template answers.                                                                                                      |
| Hosting                                             | Fixed   | One small always-on instance. TODO(verify): current Render "starter" price — not quoted from memory.                                              |

## Model and price

- Model: `claude-haiku-4-5` (env `LLM_MODEL`).
- Price: **$1 / MTok input, $5 / MTok output**; Batch API **$0.50 / $2.50**.
  Source: <https://platform.claude.com/docs/en/about-claude/pricing>, checked **2026-10-06**.
- **Prompt caching does not apply.** Haiku 4.5's minimum cacheable prompt is
  **4,096 tokens** (<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>,
  checked 2026-10-06). Both system prompts are far below that, so every call pays full input
  price. Padding prompts to reach the minimum would cost more than it saves at this size.

## Measured cost

Token counts come from real API responses (`usage.input_tokens` / `output_tokens`)
recorded by the two eval scripts — never estimated:

```bash
LLM_API_KEY=sk-... npm run eval:intent  -w @fpc/api   # 25 intent calls
LLM_API_KEY=sk-... npm run eval:explain -w @fpc/api   # ~40 explanations (with/without asking price)
npm run cost:report -w @fpc/api -- --write            # fills the block below
```

<!-- cost-report:begin -->

**TODO(measure):** not generated yet — the LLM evals need an API key. Run the three commands
above; `cost:report --write` replaces this block with measured tokens, cost per check, the
0% / 50% / 80% cache-hit table for 10k and 100k checks/day, and the hard daily ceiling.
<!-- cost-report:end -->

### How the numbers are computed

```
cost per uncached check = C_intent + C_explain
C_intent                = mean over measured intent calls of (in × $1 + out × $5) / 1M
C_explain               = mean over measured explanations of Σ attempts (in × $1 + out × $5) / 1M
                          (retries included — a guard rejection costs a second call)
cost per check at hit rate h = (1 − h) × (C_intent + C_explain)
daily = cost per check × checks/day
```

Simplifications, stated so they can be challenged: the same hit rate is assumed for
both cache layers; every check is counted as free text (chip edits skip call #1, so real
cost is lower); requests that fall back to the regex parser or template cost nothing but
are not subtracted.

### Are 50% and 80% hit rates realistic?

- **Intent cache** keys on the exact normalized text. Hit rate depends on how often
  people paste the _same_ listing text — plausible for a shared listing link, low for
  hand-typed descriptions. 0–50% is the honest range for this layer at launch.
- **Answer cache** keys on exactly what the explanation model receives: verdict,
  confidence, scope, basis and the list of available facts (with model and prompt
  version). The model never sees values — that's the grounding design — so two queries
  that differ only in numbers share one entry, and code renders each user's own numbers
  into the cached placeholder text. There are only a few hundred such inputs, so this
  layer's hit rate approaches 100% after warm-up, whatever the traffic.
- This was originally keyed per query (the brief's `canonicalJSON(query)` key). The
  review found that let anyone force a paid call per request by changing the asking
  price by 1 ₪, while the output didn't change. Keying on the model input closes that
  and is the more correct key: a cache key should be a function of the model's input.
  It also sharpens a product question: if the wording doesn't depend on the query, how
  much does call #2 add over the template? See README → open questions.

## At 10× (100k checks/day)

1. **Redis** behind the existing `Cache` interface (`apps/api/src/lib/cache.ts` is async
   for exactly this). Needed as soon as there is more than one instance: today the caches,
   rate-limit counters, circuit breaker and daily budget are per-process, which is only
   correct because `render.yaml` pins `numInstances: 1`. `@fastify/rate-limit` already
   supports a Redis store.
2. **Precompute every explanation input** — there are only a few hundred
   (verdict × confidence × scope × basis × fact set) — once per prompt version, so the
   request path never calls the LLM for call #2 at all.
3. **Batch API for the precompute** — 50% cheaper, latency irrelevant there.
   `cost:report` prints the cost for N = 1,000 and 10,000.
4. **Drop call #2 for HIGH-confidence common queries** — the template is already
   correct and grounded. Caveat from the data: on this 518-deal sample no query reaches
   HIGH (the largest type-level set is 13 deals; HIGH needs 15), so this lever only
   matters with the full dataset. The model-input cache key above already achieves most
   of the same saving on any data.
5. **Keep Haiku.** Both tasks are short, schema-constrained, and validated by code; a
   larger model would raise cost without changing what users can see — code computes
   every number either way.

## Abuse and the budget cap

| Control                                      | Value (config / env)                          | What happens when hit                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-IP rate limit (both POST routes, shared) | 20 / minute (`RATE_LIMIT_PER_MINUTE`)         | HTTP 429 with a Hebrew message.                                                                                                                                                                                                                                                       |
| Global daily LLM call budget (Israel date)   | 20,000 calls (`LLM_DAILY_CALL_BUDGET`)        | **No error.** Intent falls back to the regex parser, explanations to the template; the UI shows a subtle "AI unavailable" notice; stats and comparables are unaffected. Resets at midnight Israel time. The count survives restarts when `BUDGET_STATE_FILE` is on a persistent disk. |
| Circuit breaker                              | 5 consecutive infra failures → 30 s open      | Same template mode; one trial call after 30 s.                                                                                                                                                                                                                                        |
| Input size                                   | 500 chars text, 8 KB body                     | HTTP 400. Bounds input tokens per call.                                                                                                                                                                                                                                               |
| Output size                                  | `max_tokens` 512 (intent), 800 (explanation)  | Bounds output tokens per call.                                                                                                                                                                                                                                                        |
| Client IP                                    | `TRUST_PROXY_HOPS`: 0 by default, 1 on Render | Only a real proxy's `X-Forwarded-For` is trusted, so clients can't spoof their IP to dodge the per-IP limit.                                                                                                                                                                          |
| Rejected API key                             | 10 min cooldown                               | One failing call, then template mode with an "unavailable" notice, an error-level log and `mode: degraded` in `/api/health` — not repeated failing calls.                                                                                                                             |

**What actually caps spend.** The in-app budget limits calls per day and, with
`BUDGET_STATE_FILE` on a persistent disk, survives restarts and deploys. It is still
enforced by this process, so the **hard** cap is a monthly spend limit set in the
Anthropic Console for this key's workspace — set it at deploy time (see README →
Deploy). Within the in-app budget, the bill is at most 20,000 calls/day × the most
expensive possible call (largest measured input + full `max_tokens` output); the
measured ceiling is in the generated block above. The per-IP limit stops a single
client from burning the budget quickly, and the model-input cache key means repeated
or tweaked queries don't create new calls; a distributed attack with genuinely
different inputs can still exhaust the budget, and the product then degrades to
template mode rather than failing — the intended trade-off for a personal budget.

Live spend is at `GET /api/metrics` (`llmToday.estimatedSpendUsd`, tokens, calls, error
counts, p50/p95 latency; budget at `budget.used / limit`). It requires
`Authorization: Bearer $METRICS_TOKEN` and is disabled when no token is set — spend and
remaining budget would otherwise tell an attacker when the budget is nearly gone.
