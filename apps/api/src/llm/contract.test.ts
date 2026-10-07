import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ExplanationLlmOutputSchema } from '../explain/prompt.js';
import { IntentLlmOutputSchema } from '../intent/prompt.js';
import { AnthropicLlmClient } from './anthropicClient.js';
import type { Recording } from './recordingFetch.js';

// Replays real, recorded provider responses (see recordings/README.md) through the
// real SDK and our schemas. No recordings yet → reported as skipped, not as passing.

const dir = join(dirname(fileURLToPath(import.meta.url)), 'recordings');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording;

describe.skipIf(files.length === 0)('LLM contract: recorded responses', () => {
  it.each(files)('%s parses through the real client', async (file) => {
    const rec = load(file);
    const req = rec.request as { system: string; messages: { content: string }[]; max_tokens: number };
    const schema: z.ZodType<unknown> = req.system.includes('structured search query')
      ? IntentLlmOutputSchema
      : ExplanationLlmOutputSchema;
    const llm = new AnthropicLlmClient('replay', 'replay', {
      fetch: async () => new Response(JSON.stringify(rec.response), { status: rec.status }),
    });
    const run = llm.generateJson({
      purpose: 'replay',
      system: req.system,
      user: req.messages[0]!.content,
      schema,
      maxTokens: req.max_tokens,
      timeoutMs: 5_000,
    });
    if (rec.status === 200) await expect(run).resolves.toHaveProperty('data');
    else await expect(run).rejects.toHaveProperty('kind');
  });
});
