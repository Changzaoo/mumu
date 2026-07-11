import type { RadioStation } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';

export const radiosRepository = {
  list(genre?: string): Promise<RadioStation[]> {
    return prisma.radioStation.findMany({
      where: genre ? { genre: { equals: genre, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
    });
  },

  findById(id: string): Promise<RadioStation | null> {
    return prisma.radioStation.findUnique({ where: { id } });
  },
};
