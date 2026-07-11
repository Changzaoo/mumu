import { prisma } from '../../infra/db/prisma.js';
import { userInclude, type UserRow } from '../shared/mappers.js';

export const authRepository = {
  findById(id: string): Promise<UserRow | null> {
    return prisma.user.findUnique({ where: { id }, include: userInclude });
  },

  async touchLastSeen(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
  },
};
