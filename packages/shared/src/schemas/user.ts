import { z } from 'zod';
import { USER_ROLES } from '../constants.js';

export const userRoleSchema = z.enum(USER_ROLES);

/** Public user shape returned by the API. */
export const userSchema = z.object({
  id: z.string(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  bio: z.string().nullable(),
  role: userRoleSchema,
  isPremium: z.boolean(),
  followersCount: z.number().int(),
  followingCount: z.number().int(),
  createdAt: z.string(),
  /** Present only when the request is authenticated. */
  isFollowing: z.boolean().optional(),
});
export type UserDto = z.infer<typeof userSchema>;

/** Private profile (self) — includes settings/email. */
export const meSchema = userSchema.extend({
  email: z.string().email().nullable(),
  socialLinks: z.record(z.string()).nullable(),
  settings: z
    .object({
      theme: z.enum(['dark', 'light', 'system']).default('dark'),
      language: z.string().default('pt-BR'),
      audioQuality: z.enum(['low', 'normal', 'high', 'lossless']).default('high'),
      crossfadeSeconds: z.number().min(0).max(12).default(0),
      gapless: z.boolean().default(true),
      normalizeVolume: z.boolean().default(true),
      explicitContent: z.boolean().default(true),
      privateSession: z.boolean().default(false),
      notifications: z.boolean().default(true),
    })
    .partial()
    .nullable(),
});
export type MeDto = z.infer<typeof meSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  handle: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_.]+$/, 'lowercase letters, numbers, _ and . only')
    .optional(),
  bio: z.string().max(300).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  socialLinks: z.record(z.string().url()).optional(),
  settings: meSchema.shape.settings.unwrap().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const userStatsSchema = z.object({
  totalListeningMs: z.number(),
  tracksPlayed: z.number(),
  topGenres: z.array(z.object({ genre: z.string(), count: z.number() })),
  topArtists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      imageUrl: z.string().nullable(),
      plays: z.number(),
    }),
  ),
  topTracks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      coverUrl: z.string().nullable(),
      plays: z.number(),
    }),
  ),
  badges: z.array(
    z.object({ id: z.string(), name: z.string(), icon: z.string(), earnedAt: z.string() }),
  ),
});
export type UserStatsDto = z.infer<typeof userStatsSchema>;
