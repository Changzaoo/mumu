import type { BanUserInput, PageQuery, UserRole } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { adminService } from './admin.service.js';

export const adminController = {
  stats: asyncHandler(async (_req, res) => {
    ok(res, await adminService.stats());
  }),

  listUsers: asyncHandler(async (req, res) => {
    const { page, perPage, q } = req.valid.query as PageQuery & { q?: string };
    const result = await adminService.listUsers(q, page, perPage);
    ok(res, result.items, result.meta);
  }),

  updateUser: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const body = req.valid.body as { role?: UserRole; isPremium?: boolean };
    ok(res, await adminService.updateUser(currentUser(req).id, id, body));
  }),

  banUser: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const body = req.valid.body as BanUserInput;
    ok(res, await adminService.banUser(currentUser(req).id, id, body));
  }),

  unbanUser: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await adminService.unbanUser(currentUser(req).id, id));
  }),

  listUploads: asyncHandler(async (req, res) => {
    const { page, perPage, status } = req.valid.query as PageQuery & { status?: string };
    const result = await adminService.listUploads(status, page, perPage);
    ok(res, result.items, result.meta);
  }),

  jobs: asyncHandler(async (_req, res) => {
    ok(res, await adminService.jobs());
  }),

  logs: asyncHandler(async (req, res) => {
    const { page, perPage } = req.valid.query as PageQuery;
    const result = await adminService.auditLogs(page, perPage);
    ok(res, result.items, result.meta);
  }),

  analyticsPlays: asyncHandler(async (req, res) => {
    const { days } = req.valid.query as { days: number };
    ok(res, await adminService.playsPerDay(days));
  }),
};
