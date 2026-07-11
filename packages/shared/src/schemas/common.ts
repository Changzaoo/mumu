import { z } from 'zod';
import { PAGINATION } from '../constants.js';

export const idSchema = z.string().min(1).max(64);

export const idParamSchema = z.object({ id: idSchema });

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface CursorMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Success envelope returned by every API endpoint. */
export interface ApiSuccess<T, M = undefined> {
  data: T;
  meta?: M;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const urlSchema = z.string().url().max(2048);
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
