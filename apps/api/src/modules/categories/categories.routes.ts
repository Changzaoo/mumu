import { Router } from 'express';
import { categoriesController } from './categories.controller.js';

export const categoriesRoutes = Router();

categoriesRoutes.get('/', categoriesController.list);
