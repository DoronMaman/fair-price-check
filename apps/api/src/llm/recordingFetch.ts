import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Recording = { recordedAt: string; request: unknown; status: number; response: unknown };

/**
 * A fetch that also saves each request/response pair as JSON. Used only when
 * LLM_RECORD_DIR is set (evals), to build the replay fixtures that the contract
 * test runs through the real SDK + validation. The API key is a header, and
 * headers are not saved.
 */
export function recordingFetch(dir: string, inner: typeof fetch = fetch): typeof fetch {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (input, init) => {
    const res = await inner(input, init);
    const body: unknown = await res
      .clone()
      .json()
      .catch(() => null);
    const recording: Recording = {
      recordedAt: new Date().toISOString(),
      request: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      status: res.status,
      response: body,
    };
    const name = `${Date.now()}-${String(++n).padStart(3, '0')}.json`;
    writeFileSync(join(dir, name), JSON.stringify(recording, null, 2));
    return res;
  };
}
