import { Router } from 'express';
import { createImportSchema, createLinkImportSchema, idParamSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { uploadRateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { importsController } from './imports.controller.js';

export const importsRoutes: Router = Router();

importsRoutes.post(
  '/cloud',
  requireAuth,
  uploadRateLimit,
  validate({ body: createImportSchema }),
  importsController.create,
);

// Self-hosted link importer (yt-dlp). The service itself refuses when
// LINK_IMPORT_ENABLED is false — this route is always mounted so the web can
// read the capability from GET /imports/config.
importsRoutes.get('/config', requireAuth, importsController.config);
importsRoutes.post(
  '/link',
  requireAuth,
  uploadRateLimit,
  validate({ body: createLinkImportSchema }),
  importsController.createLink,
);

importsRoutes.get(
  '/:id/status',
  requireAuth,
  validate({ params: idParamSchema }),
  importsController.status,
);
