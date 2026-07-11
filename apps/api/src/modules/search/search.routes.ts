import { Router } from 'express';
import { searchQuerySchema, suggestQuerySchema } from '@aurial/shared';
import { validate } from '../../middlewares/validate.js';
import { searchController } from './search.controller.js';

export const searchRoutes: Router = Router();

searchRoutes.get('/', validate({ query: searchQuerySchema }), searchController.search);
searchRoutes.get('/suggest', validate({ query: suggestQuerySchema }), searchController.suggest);
