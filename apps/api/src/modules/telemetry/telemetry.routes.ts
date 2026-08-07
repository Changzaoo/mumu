import { Router } from 'express';
import { requireRole } from '../../middlewares/auth.js';
import { telemetryController } from './telemetry.controller.js';

/** Montado em /telemetria. */
export const telemetryRoutes: Router = Router();

// ESCRITA ABERTA — é o conserto inteiro. A telemetria antiga só gravava para
// quem tinha conta, e por isso o painel nunca mostrou um visitante sequer.
// Exigir login para contar quem não fez login é uma contradição.
telemetryRoutes.put('/:deviceId', telemetryController.registrar);

// LEITURA restrita: o painel expõe o uso de todo mundo.
telemetryRoutes.get('/', requireRole('ADMIN'), telemetryController.listar);
