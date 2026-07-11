import { Router } from 'express';
import { createImportSchema, idParamSchema } from '@aurial/shared';
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
importsRoutes.get(
  '/:id/status',
  requireAuth,
  validate({ params: idParamSchema }),
  importsController.status,
);
