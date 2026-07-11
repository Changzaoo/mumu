import { z } from 'zod';
import { trackSchema } from './music.js';
import { userSchema } from './user.js';

export const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  user: userSchema.pick({ id: true, handle: true, displayName: true, avatarUrl: true }),
  createdAt: z.string(),
  likesCount: z.number().int(),
  isLiked: z.boolean().optional(),
});
export type CommentDto = z.infer<typeof commentSchema>;

export const createCommentSchema = z.object({
  body: z.string().min(1).max(500),
});

export const feedEventTypeSchema = z.enum([
  'PLAYED_TRACK',
  'LIKED_TRACK',
  'CREATED_PLAYLIST',
  'FOLLOWED_ARTIST',
  'FOLLOWED_USER',
  'UPLOADED_TRACK',
]);

export const feedEventSchema = z.object({
  id: z.string(),
  type: feedEventTypeSchema,
  actor: userSchema.pick({ id: true, handle: true, displayName: true, avatarUrl: true }),
  track: trackSchema.nullable(),
  targetId: z.string().nullable(),
  targetTitle: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedEventDto = z.infer<typeof feedEventSchema>;

/** Listen-together session (socket.io). */
export const listenSessionSchema = z.object({
  id: z.string(),
  hostUserId: z.string(),
  participants: z.array(
    userSchema.pick({ id: true, handle: true, displayName: true, avatarUrl: true }),
  ),
  currentTrack: trackSchema.nullable(),
  positionMs: z.number().int(),
  isPlaying: z.boolean(),
  createdAt: z.string(),
});
export type ListenSessionDto = z.infer<typeof listenSessionSchema>;

/** WS payloads. */
export const sessionSyncSchema = z.object({
  sessionId: z.string(),
  trackId: z.string().nullable(),
  positionMs: z.number().int(),
  isPlaying: z.boolean(),
  at: z.number(),
});
export type SessionSyncPayload = z.infer<typeof sessionSyncSchema>;
