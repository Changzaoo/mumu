import { Router } from 'express';
import { z } from 'zod';
import { idSchema } from '@aurial/shared';
import { validate } from '../../middlewares/validate.js';
import { streamController } from './stream.controller.js';

const tokenQuerySchema = z.object({ token: z.string().min(10).max(256) });
const manifestParamsSchema = z.object({ trackId: idSchema });
const segmentParamsSchema = z.object({
  trackId: idSchema,
  quality: z.string().max(16),
  file: z.string().max(64),
});

export const streamRoutes: Router = Router();

streamRoutes.get(
  '/:trackId/manifest.m3u8',
  validate({ params: manifestParamsSchema, query: tokenQuerySchema }),
  streamController.manifest,
);
streamRoutes.get(
  '/:trackId/:quality/:file',
  validate({ params: segmentParamsSchema, query: tokenQuerySchema }),
  streamController.segment,
);
