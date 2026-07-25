import type { Request, Response } from 'express';
import { cursorQuerySchema } from '@aurial/shared';
import { limitQuerySchema } from '../shared/querySchemas.js';
import { undergroundService } from './underground.service.js';
import { validate } from '../../middlewares/validate.js';

// Extended limit query schema for underground endpoints
const undergroundLimitQuerySchema = limitQuerySchema.extend({
  label: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

import { z } from 'zod';

export const undergroundController = {
  async listArtists(req: Request, res: Response) {
    const { cursor, limit } = cursorQuerySchema.parse(req.query);
    const { minListeners, maxListeners, label } = req.query;

    const result = await undergroundService.listArtists(cursor, limit, {
      minListeners: minListeners ? Number(minListeners) : undefined,
      maxListeners: maxListeners ? Number(maxListeners) : undefined,
      label: label as string | undefined,
    });

    res.json(result);
  },

  async searchArtists(req: Request, res: Response) {
    const { q: query, limit, label, location } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const artists = await undergroundService.searchArtists(query, limit ? Number(limit) : 20, {
      label: label as string | undefined,
      location: location as string | undefined,
    });

    res.json({ items: artists });
  },

  async getTracks(req: Request, res: Response) {
    const { cursor, limit } = cursorQuerySchema.parse(req.query);
    const { label, genre } = req.query;

    const result = await undergroundService.getTracks(cursor, limit, {
      label: label as string | undefined,
      genre: genre as string | undefined,
    });

    res.json(result);
  },

  async getGenres(req: Request, res: Response) {
    const { label } = req.query;
    const genres = await undergroundService.getGenres(label as string | undefined);
    res.json({ items: genres });
  },

  async getLocations(req: Request, res: Response) {
    const { label } = req.query;
    const locations = await undergroundService.getLocations(label as string | undefined);
    res.json({ items: locations });
  },

  async getTrending(req: Request, res: Response) {
    const { limit, label, days } = undergroundLimitQuerySchema.parse(req.query);
    const tracks = await undergroundService.getTrendingTracks(limit, label, days);
    res.json({ items: tracks });
  },
};
