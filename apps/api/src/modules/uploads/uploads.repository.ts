import type { Prisma, Upload } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';

export const uploadsRepository = {
  create(data: Prisma.UploadUncheckedCreateInput): Promise<Upload> {
    return prisma.upload.create({ data });
  },

  findById(id: string): Promise<Upload | null> {
    return prisma.upload.findUnique({ where: { id } });
  },

  listByUser(userId: string, cursor: string | undefined, limit: number): Promise<Upload[]> {
    return prisma.upload.findMany({
      where: { AND: [{ userId }, cursorWhere(cursor) ?? {}] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  async delete(id: string): Promise<void> {
    await prisma.upload.delete({ where: { id } });
  },
};
