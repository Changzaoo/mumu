import type { RequestHandler } from 'express';
import { AppError } from '../core/errors/index.js';

/**
 * Recusa o byte NUL (U+0000) em URL, query e corpo JSON.
 *
 * O Postgres não guarda NUL em `text`: um id `a%00b` (ou `{"title":"a\u0000b"}`)
 * vira erro de consulta do Prisma, que sobe como 500 `INTERNAL` com pilha no log.
 * É entrada de cliente, então a resposta certa é 400 antes de chegar ao banco.
 * Roda depois do `express.json` e antes das rotas.
 */
const PROFUNDIDADE_MAX = 64;

function temNulo(valor: unknown, nivel = 0): boolean {
  if (typeof valor === 'string') return valor.includes('\u0000');
  if (valor === null || typeof valor !== 'object') return false;
  if (nivel > PROFUNDIDADE_MAX) return true; // aninhamento absurdo também não é entrada legítima
  if (Array.isArray(valor)) return valor.some((v) => temNulo(v, nivel + 1));
  for (const [k, v] of Object.entries(valor)) {
    if (k.includes('\u0000') || temNulo(v, nivel + 1)) return true;
  }
  return false;
}

export const semNulo: RequestHandler = (req, _res, next) => {
  if (/%00/i.test(req.originalUrl) || req.originalUrl.includes('\u0000') || temNulo(req.body)) {
    next(new AppError('BAD_REQUEST', 'Null bytes are not allowed', 400));
    return;
  }
  next();
};
