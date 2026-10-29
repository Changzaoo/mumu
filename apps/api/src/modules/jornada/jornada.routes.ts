import { Router } from 'express';
import { atualizarJornadaSchema, conviteBodySchema } from '@radinho/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { conviteRateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { jornadaController } from './jornada.controller.js';

/** Montado em /jornada. */
export const jornadaRoutes: Router = Router();

jornadaRoutes.get('/me', requireAuth, jornadaController.me);
jornadaRoutes.put(
  '/me',
  requireAuth,
  validate({ body: atualizarJornadaSchema }),
  jornadaController.atualizar,
);

// ABERTAS: quem abre o link de convite ainda não tem conta.
jornadaRoutes.post(
  '/convite',
  conviteRateLimit,
  validate({ body: conviteBodySchema }),
  jornadaController.convite,
);
jornadaRoutes.get('/convite/:handle', conviteRateLimit, jornadaController.verConvite);
