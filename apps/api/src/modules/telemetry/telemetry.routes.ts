import { Router } from 'express';
import { requireRole } from '../../middlewares/auth.js';
import { telemetryRateLimit } from '../../middlewares/rateLimit.js';
import { telemetryController } from './telemetry.controller.js';

/** Montado em /telemetria. */
export const telemetryRoutes: Router = Router();

// ESCRITA ABERTA — é o conserto inteiro. A telemetria antiga só gravava para
// quem tinha conta, e por isso o painel nunca mostrou um visitante sequer.
// Exigir login para contar quem não fez login é uma contradição.
//
// ABERTA COM COLEIRA CURTA, e a coleira é PRÓPRIA. Esta é a única escrita da API
// que não exige conta, e é a única em que cada requisição pode criar uma linha
// nova — o `deviceId` vem do cliente. O limite global de 300/min não foi
// dimensionado para isso; ver `telemetryRateLimit`.
telemetryRoutes.put('/:deviceId', telemetryRateLimit, telemetryController.registrar);

// LEITURA restrita: o painel expõe o uso de todo mundo.
telemetryRoutes.get('/', requireRole('ADMIN'), telemetryController.listar);
