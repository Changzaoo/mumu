import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { Router, type RequestHandler } from 'express';
import { AppError } from '../../core/errors/index.js';
import multer from 'multer';
import { nanoid } from 'nanoid';
import {
  ACCEPTED_AUDIO_EXT,
  cursorQuerySchema,
  idParamSchema,
  MAX_UPLOAD_SIZE_BYTES,
  uploadMetadataSchema,
} from '@radinho/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { uploadRateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { uploadsController } from './uploads.controller.js';

const TMP_DIR = path.join(os.tmpdir(), 'radinho-uploads');
mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, _file, cb) => cb(null, nanoid(21)),
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Cheap extension gate; real validation = magic bytes in the service.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, (ACCEPTED_AUDIO_EXT as readonly string[]).includes(ext));
  },
});

/**
 * O busboy (por baixo do multer) recusa multipart torto com `Error` cru
 * ("Boundary not found", "Malformed part header", "Unexpected end of form"): sem
 * traducao isso caia no ramo final do errorHandler como 500 + pilha no log, por
 * culpa de um cliente que mandou lixo. MulterError segue para o handler de
 * sempre (413/400 com codigo proprio); o resto e corpo malformado = 400.
 */
const arquivoUnico: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err?: unknown) => {
    if (!err) {
      next();
      return;
    }
    if ((err as Error).name === 'MulterError' || err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('BAD_REQUEST', 'Malformed multipart body', 400));
  });
};

/** Mounted at /uploads (plus GET /me/uploads wired in app.ts via meUploadsRoutes). */
export const uploadsRoutes: Router = Router();

uploadsRoutes.post(
  '/',
  requireAuth,
  uploadRateLimit,
  arquivoUnico,
  validate({ body: uploadMetadataSchema }),
  uploadsController.create,
);
uploadsRoutes.get(
  '/:id/status',
  requireAuth,
  validate({ params: idParamSchema }),
  uploadsController.status,
);
uploadsRoutes.delete(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  uploadsController.delete,
);

/** Separate router for GET /me/uploads. */
export const meUploadsRoutes: Router = Router();
meUploadsRoutes.get(
  '/',
  requireAuth,
  validate({ query: cursorQuerySchema }),
  uploadsController.listMine,
);
