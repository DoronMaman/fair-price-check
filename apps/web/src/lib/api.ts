import {
  AnalyzeResponseSchema,
  ApiErrorSchema,
  ExplainResponseSchema,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type ExplainRequest,
  type ExplainResponse,
} from '@fpc/shared';
import type { z } from 'zod';
import { webConfig } from '../config';
import { timeoutSignal } from './signals';

export class ApiRequestError extends Error {
  constructor(
    readonly kind: 'network' | 'timeout' | 'rate_limited' | 'invalid_request' | 'server' | 'bad_response',
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const timeout = timeoutSignal(webConfig.clientTimeoutMs, signal);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // superseded by a newer request — caller ignores it
    if (timeout.timedOut()) throw new ApiRequestError('timeout', 'השרת לא הגיב בזמן. נסו שוב.');
    throw new ApiRequestError('network', 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
  } finally {
    timeout.dispose();
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    if (res.status === 429)
      throw new ApiRequestError('rate_limited', err.success ? err.data.message : 'יותר מדי בקשות.');
    if (res.status === 400) throw new ApiRequestError('invalid_request', 'הבקשה לא תקינה. בדקו את הפרטים ונסו שוב.');
    throw new ApiRequestError('server', 'משהו השתבש בשרת. נסו שוב בעוד רגע.');
  }
  // The UI renders only what matches the shared contract.
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiRequestError('bad_response', 'התקבלה תשובה לא צפויה מהשרת.');
  return parsed.data;
}

export const api = {
  analyze: (req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> =>
    post('/api/analyze', req, AnalyzeResponseSchema, signal),
  explain: (req: ExplainRequest, signal?: AbortSignal): Promise<ExplainResponse> =>
    post('/api/explain', req, ExplainResponseSchema, signal),
};
