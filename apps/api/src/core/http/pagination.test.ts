import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  cursorWhere,
  decodeCursor,
  decodeNumericCursor,
  encodeCursor,
  encodeNumericCursor,
  numericCursorWhere,
  takePage,
  takePageWith,
} from './pagination.js';

describe('cursor encode/decode', () => {
  it('round-trips date + id', () => {
    const point = { date: new Date('2026-01-02T03:04:05.678Z'), id: 'ckx123' };
    const decoded = decodeCursor(encodeCursor(point));
    expect(decoded.id).toBe('ckx123');
    expect(decoded.date.toISOString()).toBe('2026-01-02T03:04:05.678Z');
  });

  it('survives ids containing the separator', () => {
    const point = { date: new Date('2026-01-01T00:00:00.000Z'), id: 'weird|id|123' };
    // encoding uses the FIRST separator only — id keeps everything after it
    const decoded = decodeCursor(encodeCursor(point));
    expect(decoded.id).toBe('weird|id|123');
  });

  it('throws ValidationError on garbage', () => {
    expect(() => decodeCursor('!!!not-base64url-json!!!')).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from('no-separator').toString('base64url'))).toThrow(
      ValidationError,
    );
    expect(() => decodeCursor(Buffer.from('not-a-date|id').toString('base64url'))).toThrow(
      ValidationError,
    );
  });
});

describe('cursorWhere', () => {
  it('returns undefined without a cursor', () => {
    expect(cursorWhere(undefined)).toBeUndefined();
  });

  it('builds a keyset OR clause on the given field', () => {
    const cursor = encodeCursor({ date: new Date('2026-05-05T00:00:00.000Z'), id: 'abc' });
    const where = cursorWhere(cursor, 'playedAt') as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
    expect(JSON.stringify(where)).toContain('playedAt');
    expect(JSON.stringify(where)).toContain('abc');
  });
});

describe('takePage', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `id-${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 10 - i)),
  }));
  const pointOf = (r: (typeof rows)[number]) => ({ date: r.createdAt, id: r.id });

  it('reports hasMore and mints nextCursor from the last returned item', () => {
    const page = takePage(rows, 4, pointOf);
    expect(page.items).toHaveLength(4);
    expect(page.meta.hasMore).toBe(true);
    expect(page.meta.nextCursor).not.toBeNull();
    const decoded = decodeCursor(page.meta.nextCursor ?? '');
    expect(decoded.id).toBe('id-3');
  });

  it('returns null cursor when the page is not full', () => {
    const page = takePage(rows, 10, pointOf);
    expect(page.items).toHaveLength(5);
    expect(page.meta.hasMore).toBe(false);
    expect(page.meta.nextCursor).toBeNull();
  });

  it('handles empty input', () => {
    const page = takePage([], 10, pointOf);
    expect(page.items).toEqual([]);
    expect(page.meta).toEqual({ nextCursor: null, hasMore: false });
  });
});

describe('numeric cursor', () => {
  it('round-trips value + id', () => {
    const decoded = decodeNumericCursor(encodeNumericCursor(0, 'artist-1'));
    expect(decoded).toEqual({ value: 0, id: 'artist-1' });
  });

  it('throws ValidationError on garbage', () => {
    expect(() => decodeNumericCursor('nope')).toThrow(ValidationError);
    expect(() => decodeNumericCursor(Buffer.from('x|id').toString('base64url'))).toThrow(
      ValidationError,
    );
  });

  it('returns undefined without a cursor', () => {
    expect(numericCursorWhere(undefined, 'monthlyListeners')).toBeUndefined();
  });

  /**
   * The bug this guards: paginating on `id` alone silently skips rows whenever
   * the numeric key ties — and for listener counts, ties are the norm.
   */
  it('breaks ties on id so equal values are not skipped', () => {
    const where = numericCursorWhere(encodeNumericCursor(0, 'id-5'), 'monthlyListeners');
    expect(where).toEqual({
      OR: [
        { monthlyListeners: { gt: 0 } },
        { AND: [{ monthlyListeners: 0 }, { id: { lt: 'id-5' } }] },
      ],
    });
  });
});

describe('takePageWith', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}`, listeners: i * 10 }));

  it('mints the next cursor from the last returned row', () => {
    const page = takePageWith(rows, 3, (r) => encodeNumericCursor(r.listeners, r.id));
    expect(page.items).toHaveLength(3);
    expect(page.meta.hasMore).toBe(true);
    expect(decodeNumericCursor(page.meta.nextCursor ?? '')).toEqual({ value: 20, id: 'id-2' });
  });

  it('reports the end of the list', () => {
    const page = takePageWith(rows, 5, (r) => encodeNumericCursor(r.listeners, r.id));
    expect(page.meta).toEqual({ nextCursor: null, hasMore: false });
  });
});
