import type { CreateImportInput, ImportJobDto } from '@aurial/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { enqueueImportSync } from '../../infra/queue/queues.js';
import { toImportJobDto } from '../shared/mappers.js';
import { importsRepository } from './imports.repository.js';

export const importsService = {
  async create(userId: string, input: CreateImportInput): Promise<ImportJobDto> {
    const row = await importsRepository.create({
      userId,
      provider: input.provider,
      folderPath: input.folderPath ?? null,
      status: 'QUEUED',
    });
    // The OAuth token rides only on the job payload — never stored in the DB.
    await enqueueImportSync({
      importJobId: row.id,
      userId,
      provider: input.provider,
      accessToken: input.accessToken,
      ...(input.folderPath !== undefined ? { folderPath: input.folderPath } : {}),
    });
    return toImportJobDto(row);
  },

  async getStatus(id: string, userId: string): Promise<ImportJobDto> {
    const row = await importsRepository.findById(id);
    if (!row) throw new NotFoundError('Import job');
    if (row.userId !== userId) throw new ForbiddenError();
    return toImportJobDto(row);
  },
};
