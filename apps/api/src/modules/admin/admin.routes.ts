import { Router } from 'express';
import { z } from 'zod';
import {
  adminUpdateUserSchema,
  banUserSchema,
  idParamSchema,
  pageQuerySchema,
  uploadStatusSchema,
} from '@aurial/shared';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { adminController } from './admin.controller.js';

const usersQuerySchema = pageQuerySchema.extend({ q: z.string().min(1).max(100).optional() });
const uploadsQuerySchema = pageQuerySchema.extend({ status: uploadStatusSchema.optional() });
const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** Mounted at /admin. Reads = MODERATOR+, mutations = ADMIN. */
export const adminRoutes: Router = Router();

adminRoutes.use(requireAuth, requireRole('MODERATOR'));

adminRoutes.get('/stats', adminController.stats);
adminRoutes.get('/users', validate({ query: usersQuerySchema }), adminController.listUsers);
adminRoutes.patch(
  '/users/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: adminUpdateUserSchema }),
  adminController.updateUser,
);
adminRoutes.post(
  '/users/:id/ban',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: banUserSchema }),
  adminController.banUser,
);
adminRoutes.delete(
  '/users/:id/ban',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  adminController.unbanUser,
);
adminRoutes.get('/uploads', validate({ query: uploadsQuerySchema }), adminController.listUploads);
adminRoutes.get('/jobs', adminController.jobs);
adminRoutes.get('/logs', validate({ query: pageQuerySchema }), adminController.logs);
adminRoutes.get(
  '/analytics/plays',
  validate({ query: analyticsQuerySchema }),
  adminController.analyticsPlays,
);
