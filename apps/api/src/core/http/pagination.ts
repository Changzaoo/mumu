import type { CursorMeta } from '@aurial/shared';
import { ValidationError } from '../errors/index.js';

export interface CursorPoint {
  /** Sort timestamp (createdAt / playedAt / publishedAt ...). */
  date: Date;
  id: string;
}

/** Opaque cursor = base64url of `<ISO date>|<id>`. */
export function encodeCursor(point: CursorPoint): string {
  return Buffer.from(`${point.date.toISOString()}|${point.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPoint {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('Invalid cursor');
  }
  const sep = decoded.indexOf('|');
  if (sep <= 0 || sep === decoded.length - 1) throw new ValidationError('Invalid cursor');
  const date = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(date.getTime())) throw new ValidationError('Invalid cursor');
  return { date, id };
}

/**
 * Prisma `where` fragment for keyset pagination over `orderBy: [{ <field>: 'desc' }, { id: 'desc' }]`.
 * Returns undefined when no cursor was provided.
 *
 * Deliberate `any`: the fragment is model-agnostic and must slot into every
 * model's `WhereInput`; the alternative is a per-model cast at ~12 call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cursorWhere(cursor: string | undefined, field = 'createdAt'): any {
  if (!cursor) return undefined;
  const point = decodeCursor(cursor);
  return {
    OR: [
      { [field]: { lt: point.date } },
      { AND: [{ [field]: point.date }, { id: { lt: point.id } }] },
    ],
  };
}

export interface CursorPage<T> {
  items: T[];
  meta: CursorMeta;
}

/**
 * Turn `limit + 1` fetched rows into a page, minting the next cursor from the
 * last returned item with `cursorOf`. Use this when the sort key is not a date;
 * for the usual `createdAt` ordering, prefer `takePage`.
 */
export function takePageWith<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.length > 0 ? items[items.length - 1] : undefined;
  return {
    items,
    meta: {
      nextCursor: hasMore && last !== undefined ? cursorOf(last) : null,
      hasMore,
    },
  };
}

/**
 * Turn `limit + 1` fetched rows into a page. `pointOf` extracts the sort key
 * of a row so the next cursor can be minted from the last returned item.
 */
export function takePage<T>(
  rows: T[],
  limit: number,
  pointOf: (row: T) => CursorPoint,
): CursorPage<T> {
  return takePageWith(rows, limit, (row) => encodeCursor(pointOf(row)));
}

/**
 * Keyset pagination over a numeric sort key ascending, tie-broken by `id desc`.
 *
 * The cursor carries BOTH keys on purpose: filtering by `id` alone skips or
 * repeats rows whenever the numeric key ties, which is the norm for things like
 * listener counts where most rows sit at zero.
 */
export function encodeNumericCursor(value: number, id: string): string {
  return Buffer.from(`${value}|${id}`, 'utf8').toString('base64url');
}

export function decodeNumericCursor(raw: string): { value: number; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('Invalid cursor');
  }
  const sep = decoded.indexOf('|');
  if (sep <= 0 || sep === decoded.length - 1) throw new ValidationError('Invalid cursor');
  const value = Number(decoded.slice(0, sep));
  if (!Number.isFinite(value)) throw new ValidationError('Invalid cursor');
  return { value, id: decoded.slice(sep + 1) };
}

/** Prisma `where` fragment matching `orderBy: [{ <field>: 'asc' }, { id: 'desc' }]`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function numericCursorWhere(cursor: string | undefined, field: string): any {
  if (!cursor) return undefined;
  const { value, id } = decodeNumericCursor(cursor);
  return {
    OR: [{ [field]: { gt: value } }, { AND: [{ [field]: value }, { id: { lt: id } }] }],
  };
}
