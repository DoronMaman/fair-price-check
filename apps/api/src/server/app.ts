import { existsSync } from 'node:fs';
import { join } from 'node:path';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { timingSafeEqual } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { AnalyzeRequestSchema, ExplainRequestSchema, type ApiError } from '@fpc/shared';
import type { z } from 'zod';
import { config } from '../config.js';
import type { BlockedReason } from '../llm/managedLlmClient.js';
import type { AppContext } from '../orchestrator/context.js';
import { handleAnalyze, handleExplain } from '../orchestrator/pipeline.js';

function llmMode(blocked: BlockedReason | null): 'llm' | 'template' | 'degraded' {
  if (blocked === null) return 'llm';
  return blocked === 'not_configured' ? 'template' : 'degraded';
}

const RATE_LIMITED: ApiError = { error: 'rate_limited', message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' };
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const NOT_FOUND: ApiError = { error: 'not_found', message: 'not found' };

/** Request URLs are logged without their query string: it can carry user text. */
const withoutQuery = (url: string) => url.split('?')[0] ?? url;

/** Logger options with the redacting request serializer applied (or logging off). */
function loggerWithRedaction(
  logger: FastifyServerOptions['logger'],
): Exclude<FastifyServerOptions['logger'], undefined> {
  if (logger === false) return false;
  return {
    ...(typeof logger === 'object' ? logger : {}),
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: withoutQuery(req.url),
        remoteAddress: req.ip,
      }),
    },
  };
}

/** Aborts when the client disconnects before we've answered, so in-flight LLM calls are cancelled. */
function disconnectSignal(reply: FastifyReply): AbortSignal {
  const ctrl = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) ctrl.abort();
  });
  return ctrl.signal;
}

/** Constant-time bearer token check. */
function hasToken(req: FastifyRequest, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function buildApp(
  ctx: AppContext,
  opts: {
    logger?: FastifyServerOptions['logger'];
    perIpPerMinute?: number;
    /** Overrides config.server.metricsToken (tests). */
    metricsToken?: string | undefined;
    /** Built frontend to serve (production). Omitted/missing → API only (dev uses Vite). */
    webDist?: string | undefined;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerWithRedaction(opts.logger ?? true),
    bodyLimit: config.server.bodyLimitBytes,
    // Trust exactly N proxy hops for the client IP (same as proxy-addr's numeric form).
    trustProxy: (_addr: string, hop: number) => hop < config.server.trustProxyHops,
  });

  // Provider failures are logged where operators look: an auth failure means a broken deployment.
  ctx.llm.setErrorListener((kind, message) => {
    if (kind === 'auth_failed') app.log.error({ llmError: kind }, `LLM key rejected by provider: ${message}`);
    else app.log.warn({ llmError: kind }, `LLM call failed: ${message}`);
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, ...RATE_LIMITED, retryAfterMs: c.ttl }),
  });
  const limited = {
    rateLimit: {
      max: opts.perIpPerMinute ?? config.abuse.perIpPerMinute,
      timeWindow: '1 minute',
      // One shared per-IP counter for both POST routes.
      groupId: 'api',
    },
  };

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.code(429).send(RATE_LIMITED);
    if (status < 500)
      return reply.code(status).send({ error: 'invalid_request', message: err.message } satisfies ApiError);
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'שגיאה פנימית', requestId: req.id } satisfies ApiError);
  });

  /** zod-validate a body; on failure reply 400 and return null. */
  function parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): T | null {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
    reply.code(400).send({
      error: 'invalid_request',
      message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    } satisfies ApiError);
    return null;
  }

  app.post('/api/analyze', { config: limited }, async (req, reply) => {
    const body = parseBody(AnalyzeRequestSchema, req.body, reply);
    if (!body) return reply;
    ctx.metrics.request('analyze');
    const { response, log } = await handleAnalyze(body, ctx, { signal: disconnectSignal(reply) });
    req.log.info({ route: 'analyze', ...log }, 'analyze');
    return response;
  });

  app.post('/api/explain', { config: limited }, async (req, reply) => {
    const body = parseBody(ExplainRequestSchema, req.body, reply);
    if (!body) return reply;
    ctx.metrics.request('explain');
    const { response, log } = await handleExplain(body, ctx, { signal: disconnectSignal(reply) });
    req.log.info({ route: 'explain', ...log }, 'explain');
    return response;
  });

  app.get('/api/data-quality', async () => ctx.dataset.report);

  app.get('/api/health', async () => ({
    status: 'ok',
    dataVersion: ctx.dataset.dataVersion,
    deals: ctx.dataset.deals.length,
    llm: {
      configured: ctx.llm.configured,
      model: ctx.llm.configured ? ctx.llm.model : null,
      circuit: ctx.breaker.state(),
      // "template" = LLM off by design (no key); "degraded" = it should work but currently can't.
      mode: llmMode(ctx.llm.blockedReason()),
      blockedReason: ctx.llm.blockedReason(),
    },
  }));

  // Spend and remaining budget are operator data: an attacker could use them to time
  // budget exhaustion. Disabled unless a token is configured; then bearer-protected.
  const metricsToken = 'metricsToken' in opts ? opts.metricsToken : config.server.metricsToken;
  app.get('/api/metrics', async (req, reply) => {
    if (!metricsToken) return reply.code(404).send(NOT_FOUND);
    if (!hasToken(req, metricsToken)) {
      return reply
        .code(401)
        .send({ error: 'unauthorized', message: 'metrics require a bearer token' } satisfies ApiError);
    }
    return { ...ctx.metrics.snapshot(), budget: ctx.budget.snapshot(), circuit: ctx.breaker.state() };
  });

  // The page loads only its own assets (fonts are self-hosted), so the CSP can be 'self'-only.
  // style-src needs 'unsafe-inline' for React style attributes (range-bar positions).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
  });

  const web = opts.webDist;
  if (web && existsSync(join(web, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: web,
      // Vite emits content-hashed file names under /assets → cache them forever.
      maxAge: '365d',
      immutable: true,
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.header('cache-control', 'no-cache');
      },
    });
    // Single-page app: unknown GETs (e.g. /?q=… deep links) get index.html; unknown /api/* stays a JSON 404.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send(NOT_FOUND);
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send(NOT_FOUND));
  }

  return app;
}
