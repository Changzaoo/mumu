import { createHmac, timingSafeEqual } from 'node:crypto';
import { STREAM_TOKEN_TTL_SECONDS } from '@aurial/shared';
import { env } from '../../config/index.js';

export interface StreamTokenOptions {
  secret?: string;
  ttlSeconds?: number;
  /** Clock override for tests (ms since epoch). */
  nowMs?: number;
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Short-lived HMAC token binding a trackId to an expiry: `<exp>.<sig>`.
 * Sent as `?token=` on every /stream request (ARCHITECTURE §8).
 */
export function signStreamToken(trackId: string, opts: StreamTokenOptions = {}): string {
  const secret = opts.secret ?? env.STREAM_TOKEN_SECRET;
  const ttl = opts.ttlSeconds ?? STREAM_TOKEN_TTL_SECONDS;
  const now = opts.nowMs ?? Date.now();
  const exp = Math.floor(now / 1000) + ttl;
  return `${exp}.${hmac(`${trackId}.${exp}`, secret)}`;
}

export function verifyStreamToken(
  trackId: string,
  token: string,
  opts: StreamTokenOptions = {},
): boolean {
  const secret = opts.secret ?? env.STREAM_TOKEN_SECRET;
  const now = opts.nowMs ?? Date.now();
  const sep = token.indexOf('.');
  if (sep <= 0) return false;
  const expRaw = token.slice(0, sep);
  const sig = token.slice(sep + 1);
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = hmac(`${trackId}.${exp}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
