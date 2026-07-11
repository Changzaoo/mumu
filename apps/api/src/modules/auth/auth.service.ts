import type { MeDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { toMeDto } from '../shared/mappers.js';
import { authRepository } from './auth.repository.js';

export const authService = {
  /**
   * The auth middleware already verified the token and upserted the user —
   * a session "create" just returns the fresh profile.
   */
  async createSession(userId: string): Promise<MeDto> {
    const user = await authRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toMeDto(user);
  },

  async endSession(userId: string): Promise<void> {
    // Stateless JWT auth — nothing to revoke server-side; record activity.
    await authRepository.touchLastSeen(userId).catch(() => undefined);
  },
};
