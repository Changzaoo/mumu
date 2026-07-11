import { z } from 'zod';
import {
  albumSchema,
  artistSchema,
  radioStationSchema,
  trackSchema,
  podcastSchema,
} from './music.js';
import { playlistSchema } from './playlist.js';
import { continueListeningSchema } from './library.js';
import { MOODS } from '../constants.js';

export const homeSectionItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('track'), item: trackSchema }),
  z.object({ kind: z.literal('album'), item: albumSchema }),
  z.object({ kind: z.literal('artist'), item: artistSchema }),
  z.object({ kind: z.literal('playlist'), item: playlistSchema }),
  z.object({ kind: z.literal('podcast'), item: podcastSchema }),
  z.object({ kind: z.literal('radio'), item: radioStationSchema }),
]);
export type HomeSectionItem = z.infer<typeof homeSectionItemSchema>;

export const homeSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Layout hint for the client. */
  layout: z.enum(['carousel', 'grid', 'list', 'hero']),
  items: z.array(homeSectionItemSchema),
});
export type HomeSectionDto = z.infer<typeof homeSectionSchema>;

export const homeSchema = z.object({
  greeting: z.string(),
  continueListening: z.array(continueListeningSchema),
  sections: z.array(homeSectionSchema),
});
export type HomeDto = z.infer<typeof homeSchema>;

export const moodSchema = z.enum(MOODS);

export const dailyMixSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  coverUrl: z.string().nullable(),
  tracks: z.array(trackSchema),
});
export type DailyMixDto = z.infer<typeof dailyMixSchema>;
