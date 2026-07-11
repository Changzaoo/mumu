import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { isTest } from '../config/index.js';
import { redis } from '../infra/redis/redis.js';

interface LimiterOptions {
  name: string;
  windowMs: number;
  max: number;
  message: string;
}

/** Redis-backed limiter factory; keys live under `ratelimit:<name>:`. */
function createLimiter({ name, windowMs, max, message }: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => `${req.ip ?? 'unknown'}`,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
    store: new RedisStore({
      prefix: `ratelimit:${name}:`,
      sendCommand: (...args: string[]) =>
        redis.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
    }),
  });
}

/** Global API limit — 300 req/min/IP (ARCHITECTURE §3). */
export const globalRateLimit = createLimiter({
  name: 'global',
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many requests, slow down',
});

/** Auth endpoints — 20 req/min/IP. */
export const authRateLimit = createLimiter({
  name: 'auth',
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many auth attempts, try again in a minute',
});

/** Uploads — 10 req/hour/IP. */
export const uploadRateLimit = createLimiter({
  name: 'upload',
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Upload limit reached (10/hour), try again later',
});
