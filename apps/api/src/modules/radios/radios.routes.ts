import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema } from '@aurial/shared';
import { validate } from '../../middlewares/validate.js';
import { radiosController } from './radios.controller.js';

const radiosQuerySchema = z.object({ genre: z.string().min(1).max(50).optional() });

export const radiosRoutes: Router = Router();

radiosRoutes.get('/', validate({ query: radiosQuerySchema }), radiosController.list);
radiosRoutes.get('/:id', validate({ params: idParamSchema }), radiosController.getById);
