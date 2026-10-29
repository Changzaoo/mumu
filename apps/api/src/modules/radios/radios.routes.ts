import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema } from '@radinho/shared';
import { validate } from '../../middlewares/validate.js';
import { radiosController } from './radios.controller.js';

const radiosQuerySchema = z.object({ genre: z.string().min(1).max(50).optional() });

export const radiosRoutes: Router = Router();

const agoraParamsSchema = z.object({
  estacao: z.string().regex(/^[0-9a-f-]{36}$/i),
});

radiosRoutes.get('/', validate({ query: radiosQuerySchema }), radiosController.list);
// O que toca agora numa rádio do Radio Browser (ver agora.ts).
radiosRoutes.get(
  '/agora/:estacao',
  validate({ params: agoraParamsSchema }),
  radiosController.agora,
);
radiosRoutes.get('/:id', validate({ params: idParamSchema }), radiosController.getById);
