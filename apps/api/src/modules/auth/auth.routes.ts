import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { authRateLimit } from '../../middlewares/rateLimit.js';
import { authController } from './auth.controller.js';

export const authRoutes: Router = Router();

authRoutes.post('/session', authRateLimit, requireAuth, authController.createSession);
authRoutes.delete('/session', authRateLimit, requireAuth, authController.deleteSession);
