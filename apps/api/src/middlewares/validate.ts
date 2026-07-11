import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Parses inputs with Zod and attaches the result to `req.valid`.
 * (Express 5 exposes req.query via a getter, so parsed values live on req.valid.)
 * ZodErrors fall through to the errorHandler → 422.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      req.valid = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
