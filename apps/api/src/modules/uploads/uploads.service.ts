import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { customAlphabet } from 'nanoid';
import {
  ACCEPTED_AUDIO_EXT,
  ACCEPTED_AUDIO_MIME,
  type UploadDto,
  type UploadMetadataInput,
} from '@aurial/shared';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { enqueueAudioProcess } from '../../infra/queue/queues.js';
import { getUploadProgress, setUploadProgress } from '../../infra/queue/uploadProgress.js';
import { getStorage } from '../../infra/storage/index.js';
import { toUploadDto } from '../shared/mappers.js';
import { uploadsRepository } from './uploads.repository.js';

const newUploadId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24);

export interface ReceivedFile {
  /** Multer temp path on local disk. */
  path: string;
  originalname: string;
  size: number;
}

async function progressFor(status: string, uploadId: string): Promise<number> {
  if (status === 'READY') return 100;
  if (status === 'QUEUED') return 0;
  return (await getUploadProgress(uploadId)) ?? 0;
}

export const uploadsService = {
  async create(
    userId: string,
    file: ReceivedFile,
    overrides: UploadMetadataInput,
  ): Promise<UploadDto> {
    try {
      // Magic-byte sniffing — never trust the client mime/extension.
      const detected = await fileTypeFromFile(file.path);
      const mimeOk = detected && (ACCEPTED_AUDIO_MIME as readonly string[]).includes(detected.mime);
      const extOk =
        detected && (ACCEPTED_AUDIO_EXT as readonly string[]).includes(`.${detected.ext}`);
      if (!detected || (!mimeOk && !extOk)) {
        throw new ValidationError('Unsupported or corrupt audio file', {
          detected: detected?.mime ?? 'unknown',
        });
      }

      const uploadId = newUploadId();
      const rawKey = `uploads/raw/${uploadId}`;
      await getStorage().put(rawKey, createReadStream(file.path), detected.mime);

      const row = await uploadsRepository.create({
        id: uploadId,
        userId,
        fileName: file.originalname,
        sizeBytes: BigInt(file.size),
        mimeType: detected.mime,
        rawKey,
        status: 'QUEUED',
      });

      await setUploadProgress(uploadId, 0);
      await enqueueAudioProcess({
        uploadId,
        userId,
        rawKey,
        fileName: file.originalname,
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      });

      return toUploadDto(row, 0);
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  },

  async getStatus(id: string, userId: string, isModerator: boolean): Promise<UploadDto> {
    const row = await uploadsRepository.findById(id);
    if (!row) throw new NotFoundError('Upload');
    if (row.userId !== userId && !isModerator) throw new ForbiddenError();
    return toUploadDto(row, await progressFor(row.status, row.id));
  },

  async listMine(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<UploadDto>> {
    const rows = await uploadsRepository.listByUser(userId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    const items = await Promise.all(
      page.items.map(async (r) => toUploadDto(r, await progressFor(r.status, r.id))),
    );
    return { items, meta: page.meta };
  },

  async delete(id: string, userId: string, isModerator: boolean): Promise<void> {
    const row = await uploadsRepository.findById(id);
    if (!row) throw new NotFoundError('Upload');
    if (row.userId !== userId && !isModerator) throw new ForbiddenError();
    await getStorage().delete(row.rawKey);
    await uploadsRepository.delete(id);
  },
};
