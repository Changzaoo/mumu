import { z } from 'zod';

export const uploadStatusSchema = z.enum([
  'QUEUED',
  'PROBING',
  'TRANSCODING',
  'ANALYZING',
  'READY',
  'FAILED',
]);
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const uploadSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  status: uploadStatusSchema,
  /** 0..100 while processing. */
  progress: z.number().min(0).max(100),
  error: z.string().nullable(),
  trackId: z.string().nullable(),
  createdAt: z.string(),
});
export type UploadDto = z.infer<typeof uploadSchema>;

/** Optional metadata overrides sent alongside the file (multipart fields). */
export const uploadMetadataSchema = z.object({
  title: z.string().max(200).optional(),
  artist: z.string().max(200).optional(),
  album: z.string().max(200).optional(),
});
export type UploadMetadataInput = z.infer<typeof uploadMetadataSchema>;

export const importProviderSchema = z.enum(['google-drive', 'dropbox', 'onedrive']);
export type ImportProvider = z.infer<typeof importProviderSchema>;

export const createImportSchema = z.object({
  provider: importProviderSchema,
  /** OAuth access token obtained client-side for the user's own cloud storage. */
  accessToken: z.string().min(1),
  folderPath: z.string().optional(),
});
export type CreateImportInput = z.infer<typeof createImportSchema>;

export const importJobSchema = z.object({
  id: z.string(),
  provider: importProviderSchema,
  status: z.enum(['QUEUED', 'SCANNING', 'IMPORTING', 'DONE', 'FAILED']),
  totalFiles: z.number().int(),
  importedFiles: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ImportJobDto = z.infer<typeof importJobSchema>;
