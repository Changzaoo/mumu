import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../core/errors/index.js';
import { logger } from '../core/logger.js';
import { urlSemSegredos } from './urlSemSegredos.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // Multer errors (file too large, unexpected field) — name check avoids importing multer here.
  if ((err as Error).name === 'MulterError') {
    const code = (err as { code?: string }).code;
    res.status(code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: { code: code ?? 'UPLOAD_ERROR', message: (err as Error).message },
    });
    return;
  }

  // Erros CONHECIDOS do Prisma que nascem de entrada do cliente (e nao de defeito nosso).
  if ((err as Error).name === 'PrismaClientKnownRequestError') {
    const codigo = (err as { code?: string }).code;
    const mapa: Record<string, [number, string]> = {
      P2025: [404, 'NOT_FOUND'], // registro a alterar/apagar nao existe
      P2002: [409, 'CONFLICT'], // unicidade
      P2003: [409, 'CONFLICT'], // chave estrangeira
      P2000: [400, 'BAD_REQUEST'], // valor longo demais para a coluna
      P2023: [400, 'BAD_REQUEST'], // dado inconsistente (ex.: byte invalido)
    };
    const alvo = codigo ? mapa[codigo] : undefined;
    if (alvo) {
      res
        .status(alvo[0])
        .json({ error: { code: alvo[1], message: 'Request could not be applied' } });
      return;
    }
  }

  // Payload/JSON errors from express.json / multer expose a status.
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: { code: 'BAD_REQUEST', message: (err as Error).message || 'Bad request' },
    });
    return;
  }

  logger.error({ err, requestId: req.id, url: urlSemSegredos(req.originalUrl) }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Internal server error',
      details: { requestId: req.id },
    },
  });
};
