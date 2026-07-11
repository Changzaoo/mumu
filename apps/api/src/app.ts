import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env, webOrigins } from './config/index.js';
import { requestId } from './middlewares/requestId.js';
import { httpLogger } from './middlewares/httpLogger.js';
import { authenticate } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { globalRateLimit } from './middlewares/rateLimit.js';
import { createDocsRouter } from './docs/swagger.js';
import { authRoutes } from './modules/auth/index.js';
import { usersRoutes } from './modules/users/index.js';
import { artistsRoutes } from './modules/artists/index.js';
import { albumsRoutes } from './modules/albums/index.js';
import { tracksRoutes } from './modules/tracks/index.js';
import { playlistsRoutes } from './modules/playlists/index.js';
import { libraryRoutes } from './modules/library/index.js';
import { historyRoutes } from './modules/history/index.js';
import { searchRoutes } from './modules/search/index.js';
import { homeRoutes } from './modules/home/index.js';
import { uploadsRoutes, meUploadsRoutes } from './modules/uploads/index.js';
import { importsRoutes } from './modules/imports/index.js';
import { streamRoutes } from './modules/stream/index.js';
import { podcastsRoutes } from './modules/podcasts/index.js';
import { radiosRoutes } from './modules/radios/index.js';
import { recommendationsRoutes } from './modules/recommendations/index.js';
import { socialRoutes, registerFeedProjection } from './modules/social/index.js';
import { adminRoutes } from './modules/admin/index.js';

export function createApp(): Express {
  registerFeedProjection();

  const app = express();
  app.set('trust proxy', 1); // behind nginx
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Covers under /media are consumed cross-origin by the SPA.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow non-browser clients (no Origin) and the configured allowlist.
        if (!origin || webOrigins.includes(origin)) cb(null, true);
        else cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  app.use(httpLogger);

  // Health check (compose/nginx) — no auth, no rate limit, no envelope ceremony.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ data: { status: 'ok', uptime: process.uptime() } });
  });

  // Dev static hosting for LocalDiskStorage public URLs (covers etc.).
  if (env.STORAGE_DRIVER === 'local') {
    app.use(
      '/media',
      express.static(path.resolve(env.STORAGE_LOCAL_PATH), { maxAge: '7d', index: false }),
    );
  }

  const api = express.Router();
  api.use(globalRateLimit);
  api.use(authenticate);

  api.use('/auth', authRoutes);
  api.use('/', usersRoutes); // /me, /me/stats, /users/:id...
  api.use('/artists', artistsRoutes);
  api.use('/albums', albumsRoutes);
  api.use('/tracks', tracksRoutes);
  api.use('/playlists', playlistsRoutes);
  api.use('/me/library', libraryRoutes);
  api.use('/me/history', historyRoutes);
  api.use('/me/uploads', meUploadsRoutes);
  api.use('/search', searchRoutes);
  api.use('/home', homeRoutes);
  api.use('/uploads', uploadsRoutes);
  api.use('/imports', importsRoutes);
  api.use('/stream', streamRoutes);
  api.use('/podcasts', podcastsRoutes);
  api.use('/radios', radiosRoutes);
  api.use('/recs', recommendationsRoutes);
  api.use('/', socialRoutes); // /feed, /tracks/:id/comments, /comments/:id, /sessions
  api.use('/admin', adminRoutes);

  app.use('/api/v1', api);
  app.use('/api/docs', createDocsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
