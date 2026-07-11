import { describe, expect, it } from 'vitest';
import { signStreamToken, verifyStreamToken } from './streamToken.js';
import { propagateToken } from './stream.service.js';

const secret = 'test-secret-with-enough-length';
const now = 1_760_000_000_000;

describe('stream tokens', () => {
  it('signs and verifies a token for the same track', () => {
    const token = signStreamToken('track-1', { secret, nowMs: now });
    expect(verifyStreamToken('track-1', token, { secret, nowMs: now })).toBe(true);
  });

  it('rejects a token bound to a different track', () => {
    const token = signStreamToken('track-1', { secret, nowMs: now });
    expect(verifyStreamToken('track-2', token, { secret, nowMs: now })).toBe(false);
  });

  it('rejects expired tokens', () => {
    const token = signStreamToken('track-1', { secret, ttlSeconds: 60, nowMs: now });
    expect(verifyStreamToken('track-1', token, { secret, nowMs: now + 61_000 })).toBe(false);
    expect(verifyStreamToken('track-1', token, { secret, nowMs: now + 59_000 })).toBe(true);
  });

  it('rejects tampered signatures and garbage', () => {
    const token = signStreamToken('track-1', { secret, nowMs: now });
    expect(verifyStreamToken('track-1', `${token}x`, { secret, nowMs: now })).toBe(false);
    expect(verifyStreamToken('track-1', 'not-a-token', { secret, nowMs: now })).toBe(false);
    expect(verifyStreamToken('track-1', '', { secret, nowMs: now })).toBe(false);
  });

  it('rejects tokens signed with another secret', () => {
    const token = signStreamToken('track-1', { secret: 'other-secret-that-is-long', nowMs: now });
    expect(verifyStreamToken('track-1', token, { secret, nowMs: now })).toBe(false);
  });
});

describe('propagateToken', () => {
  it('appends the token to URI lines only', () => {
    const playlist = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=103680', 'low/index.m3u8', ''].join(
      '\n',
    );
    const out = propagateToken(playlist, 'abc.def');
    expect(out).toContain('low/index.m3u8?token=abc.def');
    expect(out).toContain('#EXT-X-STREAM-INF:BANDWIDTH=103680');
    expect(out).not.toContain('#EXTM3U?token');
  });

  it('uses & when the URI already has a query', () => {
    const out = propagateToken('seg-00001.ts?v=2', 'tok');
    expect(out).toBe('seg-00001.ts?v=2&token=tok');
  });
});
