import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { categoriesRepository } from './categories.repository.js';

export const categoriesController = {
  /**
   * Lista as famílias de gêneros organizadas pela curadoria AI.
   */
  list: asyncHandler(async (_req, res) => {
    const familias = await categoriesRepository.list();
    ok(res, { familias });
  }),
};
