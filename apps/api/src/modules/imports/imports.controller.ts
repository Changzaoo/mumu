import type { CreateImportInput, CreateLinkImportInput } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { accepted, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { importsService } from './imports.service.js';

export const importsController = {
  create: asyncHandler(async (req, res) => {
    const body = req.valid.body as CreateImportInput;
    accepted(res, await importsService.create(currentUser(req).id, body));
  }),

  status: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await importsService.getStatus(id, currentUser(req).id));
  }),

  config: asyncHandler(async (_req, res) => {
    ok(res, importsService.config());
  }),

  createLink: asyncHandler(async (req, res) => {
    const body = req.valid.body as CreateLinkImportInput;
    accepted(res, await importsService.createLinkImport(currentUser(req).id, body));
  }),
};
