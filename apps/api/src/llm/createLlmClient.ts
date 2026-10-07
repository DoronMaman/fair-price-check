import { config } from '../config.js';
import { env } from '../env.js';
import { AnthropicLlmClient } from './anthropicClient.js';
import { recordingFetch } from './recordingFetch.js';
import { unconfiguredLlmClient, type LlmClient } from './LlmClient.js';

/**
 * LLM_API_KEY set → Claude; unset → a client that always fails fast, so the
 * whole app runs in deterministic/template mode. We read LLM_API_KEY explicitly
 * rather than letting the SDK discover ANTHROPIC_API_KEY or a local login
 * profile, so "is the LLM on?" has exactly one answer.
 */
export function createLlmClient(apiKey: string | undefined = env.LLM_API_KEY?.trim()): LlmClient {
  if (!apiKey) return unconfiguredLlmClient;
  return new AnthropicLlmClient(
    apiKey,
    config.llm.model,
    env.LLM_RECORD_DIR ? { fetch: recordingFetch(env.LLM_RECORD_DIR) } : {},
  );
}
