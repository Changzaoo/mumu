import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi.js';

/** Mounted at /api/docs — Swagger UI + raw JSON. */
export function createDocsRouter(): Router {
  const router = Router();
  const document = buildOpenApiDocument();

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'Aurial API' }));
  return router;
}
