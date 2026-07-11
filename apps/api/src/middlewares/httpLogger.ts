import type { IncomingMessage } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Request } from 'express';
import { logger } from '../core/logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) => (req as Request).id,
  autoLogging: {
    ignore: (req) => req.url === '/healthz' || (req.url?.startsWith('/api/docs') ?? false),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req: { method?: string; url?: string }) => ({ method: req.method, url: req.url }),
  },
});
