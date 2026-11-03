/** Espelho de `app.ts`: router -> prefixo. Mantido junto da enumeração. */
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
import { socialRoutes } from './modules/social/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { undergroundRoutes } from './modules/underground/index.js';
import { catalogRoutes } from './modules/catalog/index.js';
import { collectionsRoutes } from './modules/collections/index.js';
import { telemetryRoutes } from './modules/telemetry/index.js';
import { emAltaRoutes } from './modules/emAlta/index.js';
import { categoriesRoutes } from './modules/categories/index.js';
import { mundoRoutes } from './modules/mundo/index.js';
import { jornadaRoutes } from './modules/jornada/index.js';

const B = '/api/v1';
export const montagens = new Map<unknown, string>([
  [authRoutes, `${B}/auth`],
  [usersRoutes, B],
  [artistsRoutes, `${B}/artists`],
  [albumsRoutes, `${B}/albums`],
  [tracksRoutes, `${B}/tracks`],
  [playlistsRoutes, `${B}/playlists`],
  [libraryRoutes, `${B}/me/library`],
  [historyRoutes, `${B}/me/history`],
  [meUploadsRoutes, `${B}/me/uploads`],
  [searchRoutes, `${B}/search`],
  [homeRoutes, `${B}/home`],
  [uploadsRoutes, `${B}/uploads`],
  [importsRoutes, `${B}/imports`],
  [streamRoutes, `${B}/stream`],
  [podcastsRoutes, `${B}/podcasts`],
  [radiosRoutes, `${B}/radios`],
  [recommendationsRoutes, `${B}/recs`],
  [socialRoutes, B],
  [adminRoutes, `${B}/admin`],
  [undergroundRoutes, `${B}/underground`],
  [emAltaRoutes, `${B}/em-alta`],
  [catalogRoutes, `${B}/catalogo`],
  [collectionsRoutes, `${B}/me/colecoes`],
  [telemetryRoutes, `${B}/telemetria`],
  [categoriesRoutes, `${B}/categorias`],
  [mundoRoutes, `${B}/mundo`],
  [jornadaRoutes, `${B}/jornada`],
]);
