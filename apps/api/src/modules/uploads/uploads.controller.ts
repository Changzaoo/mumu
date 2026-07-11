import type { CursorQuery, UploadMetadataInput } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { accepted, noContent, ok } from '../../core/http/respond.js';
import { ValidationError } from '../../core/errors/index.js';
import { currentUser } from '../../middlewares/auth.js';
import { uploadsService } from './uploads.service.js';

const isModerator = (role: string): boolean => role === 'MODERATOR' || role === 'ADMIN';

export const uploadsController = {
  create: asyncHandler(async (req, res) => {
    if (!req.file)
      throw new ValidationError('Multipart field "file" with an audio file is required');
    const overrides = req.valid.body as UploadMetadataInput;
    const dto = await uploadsService.create(
      currentUser(req).id,
      { path: req.file.path, originalname: req.file.originalname, size: req.file.size },
      overrides,
    );
    accepted(res, dto);
  }),

  status: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const user = currentUser(req);
    ok(res, await uploadsService.getStatus(id, user.id, isModerator(user.role)));
  }),

  listMine: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await uploadsService.listMine(currentUser(req).id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  delete: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const user = currentUser(req);
    await uploadsService.delete(id, user.id, isModerator(user.role));
    noContent(res);
  }),
};
