import { z } from 'zod';
import { userRoleSchema } from './user.js';

export const adminStatsSchema = z.object({
  users: z.object({ total: z.number(), activeToday: z.number(), newThisWeek: z.number() }),
  tracks: z.object({ total: z.number(), processedToday: z.number() }),
  uploads: z.object({ queued: z.number(), processing: z.number(), failedToday: z.number() }),
  storage: z.object({ usedBytes: z.number(), objectCount: z.number() }),
  playback: z.object({ playsToday: z.number(), listeningHoursToday: z.number() }),
  queues: z.array(
    z.object({
      name: z.string(),
      waiting: z.number(),
      active: z.number(),
      completed: z.number(),
      failed: z.number(),
    }),
  ),
});
export type AdminStatsDto = z.infer<typeof adminStatsSchema>;

export const adminUpdateUserSchema = z.object({
  role: userRoleSchema.optional(),
  isPremium: z.boolean().optional(),
});

export const banUserSchema = z.object({
  reason: z.string().min(3).max(500),
  /** ISO date; permanent when omitted. */
  until: z.string().datetime().optional(),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

export const auditLogSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AuditLogDto = z.infer<typeof auditLogSchema>;
