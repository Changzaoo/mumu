import { Router } from 'express';
import { cursorQuerySchema, recordPlaySchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { limitQuerySchema } from '../shared/querySchemas.js';
import { historyController } from './history.controller.js';

/** Mounted at /me/history. */
export const historyRoutes: Router = Router();

historyRoutes.use(requireAuth);

historyRoutes.post('/', validate({ body: recordPlaySchema }), historyController.record);
historyRoutes.get('/recent', validate({ query: limitQuerySchema }), historyController.recent);
historyRoutes.get('/', validate({ query: cursorQuerySchema }), historyController.list);
historyRoutes.delete('/', historyController.clear);
