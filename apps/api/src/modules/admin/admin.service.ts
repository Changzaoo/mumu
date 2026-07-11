import type {
  AdminStatsDto,
  AuditLogDto,
  BanUserInput,
  PageMeta,
  UploadDto,
  UserDto,
} from '@aurial/shared';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { auditLogger } from '../../core/logger.js';
import { getQueues } from '../../infra/queue/queues.js';
import { getUploadProgress } from '../../infra/queue/uploadProgress.js';
import { toAuditLogDto, toUploadDto, toUserDto } from '../shared/mappers.js';
import { adminRepository, type PlaysPerDay } from './admin.repository.js';

function pageMeta(page: number, perPage: number, total: number): PageMeta {
  return { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

/** Every admin mutation lands in AuditLog + the structured audit logger. */
async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  auditLogger.info({ actorId, action, targetType, targetId, metadata }, 'admin action');
  await adminRepository.writeAudit(actorId, action, targetType, targetId, metadata);
}

async function queueCounts(): Promise<AdminStatsDto['queues']> {
  const queueSet = getQueues();
  return Promise.all(
    (
      [
        ['audio-process', queueSet.audioProcess],
        ['import-sync', queueSet.importSync],
        ['notifications', queueSet.notifications],
      ] as const
    ).map(async ([name, queue]) => {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
      return {
        name,
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        completed: counts['completed'] ?? 0,
        failed: counts['failed'] ?? 0,
      };
    }),
  );
}

export const adminService = {
  async stats(): Promise<AdminStatsDto> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const [users, tracks, uploads, storage, playback, queues] = await Promise.all([
      adminRepository.userCounts(startOfDay, weekAgo),
      adminRepository.trackCounts(startOfDay),
      adminRepository.uploadCounts(startOfDay),
      adminRepository.storageStats(),
      adminRepository.playbackToday(startOfDay),
      queueCounts(),
    ]);

    return { users, tracks, uploads, storage, playback, queues };
  },

  async listUsers(
    q: string | undefined,
    page: number,
    perPage: number,
  ): Promise<{ items: UserDto[]; meta: PageMeta }> {
    const [rows, total] = await adminRepository.users(q, page, perPage);
    return { items: rows.map(toUserDto), meta: pageMeta(page, perPage, total) };
  },

  async updateUser(
    actorId: string,
    userId: string,
    input: { role?: UserDto['role']; isPremium?: boolean },
  ): Promise<UserDto> {
    const exists = await adminRepository.userExists(userId);
    if (!exists) throw new NotFoundError('User');
    const row = await adminRepository.updateUser(userId, {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isPremium !== undefined ? { isPremium: input.isPremium } : {}),
    });
    await audit(actorId, 'user.update', 'User', userId, { ...input });
    return toUserDto(row);
  },

  async banUser(actorId: string, userId: string, input: BanUserInput): Promise<UserDto> {
    if (actorId === userId) throw new ValidationError('Cannot ban yourself');
    const exists = await adminRepository.userExists(userId);
    if (!exists) throw new NotFoundError('User');
    const row = await adminRepository.updateUser(userId, {
      isBanned: true,
      banReason: input.reason,
      bannedUntil: input.until !== undefined ? new Date(input.until) : null,
    });
    await audit(actorId, 'user.ban', 'User', userId, {
      reason: input.reason,
      until: input.until ?? 'permanent',
    });
    return toUserDto(row);
  },

  async unbanUser(actorId: string, userId: string): Promise<UserDto> {
    const exists = await adminRepository.userExists(userId);
    if (!exists) throw new NotFoundError('User');
    const row = await adminRepository.updateUser(userId, {
      isBanned: false,
      banReason: null,
      bannedUntil: null,
    });
    await audit(actorId, 'user.unban', 'User', userId);
    return toUserDto(row);
  },

  async listUploads(
    status: string | undefined,
    page: number,
    perPage: number,
  ): Promise<{ items: UploadDto[]; meta: PageMeta }> {
    const [rows, total] = await adminRepository.uploads(status, page, perPage);
    const items = await Promise.all(
      rows.map(async (r) =>
        toUploadDto(r, r.status === 'READY' ? 100 : ((await getUploadProgress(r.id)) ?? 0)),
      ),
    );
    return { items, meta: pageMeta(page, perPage, total) };
  },

  jobs(): Promise<AdminStatsDto['queues']> {
    return queueCounts();
  },

  async auditLogs(
    page: number,
    perPage: number,
  ): Promise<{ items: AuditLogDto[]; meta: PageMeta }> {
    const [rows, total] = await adminRepository.auditLogs(page, perPage);
    return { items: rows.map(toAuditLogDto), meta: pageMeta(page, perPage, total) };
  },

  playsPerDay(days: number): Promise<PlaysPerDay[]> {
    return adminRepository.playsPerDay(days);
  },
};
