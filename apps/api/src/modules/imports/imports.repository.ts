import type { ImportJob, Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';

export const importsRepository = {
  create(data: Prisma.ImportJobUncheckedCreateInput): Promise<ImportJob> {
    return prisma.importJob.create({ data });
  },

  findById(id: string): Promise<ImportJob | null> {
    return prisma.importJob.findUnique({ where: { id } });
  },
};
