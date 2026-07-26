import { z } from 'zod';
import { cursorQuerySchema } from '@aurial/shared';
import { limitQuerySchema } from '../shared/querySchemas.js';

/** Curation tag, e.g. "underground". Bounded so it cannot bloat a cache key. */
const catalogTag = z.string().trim().min(1).max(60).optional();

export const undergroundArtistsQuerySchema = cursorQuerySchema.extend({
  catalogTag,
  minListeners: z.coerce.number().int().min(0).optional(),
  maxListeners: z.coerce.number().int().min(0).optional(),
});
export type UndergroundArtistsQuery = z.infer<typeof undergroundArtistsQuerySchema>;

export const undergroundSearchQuerySchema = limitQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
  catalogTag,
  location: z.string().trim().min(1).max(120).optional(),
});
export type UndergroundSearchQuery = z.infer<typeof undergroundSearchQuerySchema>;

export const undergroundTracksQuerySchema = cursorQuerySchema.extend({
  catalogTag,
  genre: z.string().trim().min(1).max(80).optional(),
});
export type UndergroundTracksQuery = z.infer<typeof undergroundTracksQuerySchema>;

export const undergroundTagQuerySchema = z.object({ catalogTag });
export type UndergroundTagQuery = z.infer<typeof undergroundTagQuerySchema>;

export const undergroundTrendingQuerySchema = limitQuerySchema.extend({
  catalogTag,
  days: z.coerce.number().int().min(1).max(365).default(7),
});
export type UndergroundTrendingQuery = z.infer<typeof undergroundTrendingQuerySchema>;
