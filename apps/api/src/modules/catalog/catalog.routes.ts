import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { catalogController } from './catalog.controller.js';

/** Montado em /catalogo. */
export const catalogRoutes: Router = Router();

// Leitura ABERTA: o app toca prévia para visitante, e é o acervo que dá o que
// ouvir antes de criar conta. Era assim nas regras do Firestore.
catalogRoutes.get('/', catalogController.list);
// Uma faixa inteira, sob demanda. Depois da rota raiz e ANTES de qualquer
// rota com prefixo fixo que pudesse ser confundida com um id.
catalogRoutes.get('/:id', catalogController.detail);

// Escrita exige conta. A ordem importa: `/bulk` antes de `/:id`, senão o Express
// casaria "bulk" como se fosse um id de faixa.
catalogRoutes.post('/bulk', requireAuth, catalogController.upsertMany);
catalogRoutes.put('/:id', requireAuth, catalogController.upsert);
catalogRoutes.delete('/:id', requireAuth, catalogController.remove);
