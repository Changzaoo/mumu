import { Router } from 'express';
import { undergroundController } from './underground.controller.js';

export const undergroundRoutes = Router();

undergroundRoutes.get('/artists', undergroundController.listArtists);
undergroundRoutes.get('/artists/search', undergroundController.searchArtists);
undergroundRoutes.get('/tracks', undergroundController.getTracks);
undergroundRoutes.get('/genres', undergroundController.getGenres);
undergroundRoutes.get('/locations', undergroundController.getLocations);
undergroundRoutes.get('/trending', undergroundController.getTrending);
