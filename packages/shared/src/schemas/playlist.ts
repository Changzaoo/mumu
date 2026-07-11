import { z } from 'zod';
import { trackSchema } from './music.js';
import { userSchema } from './user.js';

export const playlistSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  dominantColor: z.string().nullable(),
  isPublic: z.boolean(),
  isCollaborative: z.boolean(),
  trackCount: z.number().int(),
  durationMs: z.number().int(),
  followersCount: z.number().int(),
  owner: userSchema.pick({ id: true, handle: true, displayName: true, avatarUrl: true }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlaylistDto = z.infer<typeof playlistSchema>;

export const playlistTrackSchema = z.object({
  /** PlaylistTrack row id — used for reorder/remove (a track can appear twice). */
  entryId: z.string(),
  position: z.number().int(),
  addedAt: z.string(),
  addedBy: userSchema.pick({ id: true, handle: true, displayName: true }).nullable(),
  track: trackSchema,
});
export type PlaylistTrackDto = z.infer<typeof playlistTrackSchema>;

export const playlistWithTracksSchema = playlistSchema.extend({
  tracks: z.array(playlistTrackSchema),
});
export type PlaylistWithTracksDto = z.infer<typeof playlistWithTracksSchema>;

export const createPlaylistSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
  isCollaborative: z.boolean().default(false),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;

export const updatePlaylistSchema = createPlaylistSchema.partial().extend({
  coverUrl: z.string().url().nullable().optional(),
});
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;

export const addPlaylistTracksSchema = z.object({
  trackIds: z.array(z.string()).min(1).max(100),
  /** Insert position; append when omitted. */
  position: z.number().int().min(0).optional(),
});
export type AddPlaylistTracksInput = z.infer<typeof addPlaylistTracksSchema>;

export const removePlaylistTracksSchema = z.object({
  entryIds: z.array(z.string()).min(1).max(100),
});

export const reorderPlaylistSchema = z.object({
  entryId: z.string(),
  toPosition: z.number().int().min(0),
});
export type ReorderPlaylistInput = z.infer<typeof reorderPlaylistSchema>;

export const addCollaboratorSchema = z.object({
  userId: z.string(),
});
