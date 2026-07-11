import { z } from 'zod';
import { albumSchema, artistSchema, trackSchema } from './music.js';
import { playlistSchema } from './playlist.js';

export const librarySchema = z.object({
  playlists: z.array(playlistSchema),
  likedTracksCount: z.number().int(),
  albums: z.array(albumSchema),
  artists: z.array(artistSchema),
});
export type LibraryDto = z.infer<typeof librarySchema>;

export const playSourceSchema = z.enum([
  'album',
  'playlist',
  'artist',
  'search',
  'home',
  'library',
  'queue',
  'radio',
  'podcast',
  'upload',
  'recommendation',
]);
export type PlaySource = z.infer<typeof playSourceSchema>;

export const recordPlaySchema = z.object({
  trackId: z.string(),
  /** Milliseconds actually listened. */
  playedMs: z.number().int().min(0),
  /** Playback context for recommendations. */
  source: playSourceSchema,
  sourceId: z.string().optional(),
  completed: z.boolean().default(false),
});
export type RecordPlayInput = z.infer<typeof recordPlaySchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  playedAt: z.string(),
  playedMs: z.number().int(),
  source: playSourceSchema,
  track: trackSchema,
});
export type HistoryEntryDto = z.infer<typeof historyEntrySchema>;

/** "Continue listening" — resume points for long content + recent context. */
export const continueListeningSchema = z.object({
  track: trackSchema,
  positionMs: z.number().int(),
  contextTitle: z.string().nullable(),
  contextUrl: z.string().nullable(),
});
export type ContinueListeningDto = z.infer<typeof continueListeningSchema>;
