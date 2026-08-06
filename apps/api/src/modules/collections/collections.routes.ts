import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { collectionsController } from './collections.controller.js';

/** Montado em /me/colecoes. Tudo aqui é privado — exige conta. */
export const collectionsRoutes: Router = Router();

collectionsRoutes.use(requireAuth);

collectionsRoutes.get('/:nome', collectionsController.delta);
collectionsRoutes.post('/:nome', collectionsController.upsert);
// Apagar vai por POST com corpo: a fila offline acumula remoções e manda todas
// de uma vez quando o servidor volta — ver o controller.
collectionsRoutes.post('/:nome/apagar', collectionsController.remove);
