import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { homeController } from './home.controller.js';

export const homeRoutes: Router = Router();

homeRoutes.get('/', requireAuth, homeController.getHome);
