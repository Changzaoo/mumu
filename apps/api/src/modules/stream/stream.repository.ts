import { prisma } from '../../infra/db/prisma.js';

export const streamRepository = {
  findStreamable(
    trackId: string,
  ): Promise<{ id: string; hlsKey: string | null; isPublic: boolean } | null> {
    return prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, hlsKey: true, isPublic: true },
    });
  },
};
