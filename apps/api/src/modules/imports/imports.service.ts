import { customAlphabet } from 'nanoid';
import type {
  CreateImportInput,
  CreateLinkImportInput,
  ImportConfigDto,
  ImportJobDto,
  UploadDto,
} from '@aurial/shared';
import { LINK_IMPORT_HOSTS } from '@aurial/shared';
import { env } from '../../config/index.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { enqueueImportSync, enqueueLinkImport } from '../../infra/queue/queues.js';
import { setUploadProgress } from '../../infra/queue/uploadProgress.js';
import { isSupportedLinkHost } from '../../infra/ytdlp/ytdlp.js';
import { toImportJobDto, toUploadDto } from '../shared/mappers.js';
import { uploadsRepository } from '../uploads/uploads.repository.js';
import { importsRepository } from './imports.repository.js';

const newUploadId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24);

/** A short, human-friendly placeholder name shown until real tags arrive. */
function placeholderName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return `Importando de ${host}…`;
  } catch {
    return 'Importando link…';
  }
}

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

  /** Capability probe for the web (only shows the importer when enabled). */
  config(): ImportConfigDto {
    return {
      linkImportEnabled: env.LINK_IMPORT_ENABLED,
      hosts: env.LINK_IMPORT_ENABLED ? [...LINK_IMPORT_HOSTS] : [],
    };
  },

  /**
   * Queue a link import. Creates an Upload row up front (so it appears in the
   * user's uploads list and reuses the existing status-polling UI), then hands
   * off to the link-import worker which downloads via yt-dlp and feeds the
   * result into the normal audio pipeline. Returns the pending UploadDto.
   */
  async createLinkImport(userId: string, input: CreateLinkImportInput): Promise<UploadDto> {
    if (!env.LINK_IMPORT_ENABLED) {
      throw new ForbiddenError('O importador por link está desativado neste servidor.');
    }
    if (!isSupportedLinkHost(input.url)) {
      throw new ValidationError(`Link não suportado. Use: ${LINK_IMPORT_HOSTS.join(', ')}.`);
    }

    const uploadId = newUploadId();
    const rawKey = `uploads/raw/${uploadId}`;
    const row = await uploadsRepository.create({
      id: uploadId,
      userId,
      fileName: placeholderName(input.url),
      sizeBytes: BigInt(0),
      mimeType: 'audio/mpeg',
      rawKey,
      status: 'QUEUED',
    });

    await setUploadProgress(uploadId, 0);
    await enqueueLinkImport({ uploadId, userId, rawKey, url: input.url });
    return toUploadDto(row, 0);
  },
};
