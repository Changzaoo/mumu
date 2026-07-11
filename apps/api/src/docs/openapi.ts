import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';
import {
  adminStatsSchema,
  adminUpdateUserSchema,
  albumSchema,
  albumWithTracksSchema,
  artistSchema,
  auditLogSchema,
  banUserSchema,
  commentSchema,
  createCommentSchema,
  createImportSchema,
  createPlaylistSchema,
  addPlaylistTracksSchema,
  addCollaboratorSchema,
  removePlaylistTracksSchema,
  reorderPlaylistSchema,
  cursorQuerySchema,
  dailyMixSchema,
  episodeSchema,
  feedEventSchema,
  historyEntrySchema,
  homeSchema,
  continueListeningSchema,
  idParamSchema,
  importJobSchema,
  librarySchema,
  listenSessionSchema,
  lyricsSchema,
  meSchema,
  moodSchema,
  pageQuerySchema,
  playlistSchema,
  playlistWithTracksSchema,
  podcastSchema,
  radioStationSchema,
  recordPlaySchema,
  searchQuerySchema,
  searchResultsSchema,
  suggestionSchema,
  suggestQuerySchema,
  trackSchema,
  updateMeSchema,
  updatePlaylistSchema,
  uploadMetadataSchema,
  uploadSchema,
  userSchema,
  userStatsSchema,
  waveformSchema,
} from '@aurial/shared';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'Firebase ID token',
});

// ── shared schema components ──
const named: Array<[string, ZodTypeAny]> = [
  ['User', userSchema],
  ['Me', meSchema],
  ['UserStats', userStatsSchema],
  ['Artist', artistSchema],
  ['Album', albumSchema],
  ['AlbumWithTracks', albumWithTracksSchema],
  ['Track', trackSchema],
  ['Waveform', waveformSchema],
  ['Lyrics', lyricsSchema],
  ['Playlist', playlistSchema],
  ['PlaylistWithTracks', playlistWithTracksSchema],
  ['Library', librarySchema],
  ['HistoryEntry', historyEntrySchema],
  ['ContinueListening', continueListeningSchema],
  ['SearchResults', searchResultsSchema],
  ['Suggestion', suggestionSchema],
  ['Home', homeSchema],
  ['DailyMix', dailyMixSchema],
  ['Upload', uploadSchema],
  ['ImportJob', importJobSchema],
  ['Podcast', podcastSchema],
  ['Episode', episodeSchema],
  ['RadioStation', radioStationSchema],
  ['Comment', commentSchema],
  ['FeedEvent', feedEventSchema],
  ['ListenSession', listenSessionSchema],
  ['AdminStats', adminStatsSchema],
  ['AuditLog', auditLogSchema],
];
for (const [name, schema] of named) registry.register(name, schema);

// ── envelopes ──
const envelope = (data: ZodTypeAny, meta?: ZodTypeAny): ZodTypeAny =>
  meta ? z.object({ data, meta }) : z.object({ data });

const cursorMetaSchema = z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() });
const pageMetaSchema = z.object({
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
registry.register('ApiError', errorBodySchema);

// ── compact path registration helper ──
interface RouteDoc {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  auth?: boolean;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  response?: ZodTypeAny;
  /** 200 unless noted; 201/202/204 supported. */
  status?: 200 | 201 | 202 | 204;
}

function route(doc: RouteDoc): void {
  const status = doc.status ?? 200;
  registry.registerPath({
    method: doc.method,
    path: doc.path,
    tags: [doc.tag],
    summary: doc.summary,
    ...(doc.auth ? { security: [{ bearerAuth: [] }] } : {}),
    request: {
      ...(doc.params ? { params: doc.params as never } : {}),
      ...(doc.query ? { query: doc.query as never } : {}),
      ...(doc.body ? { body: { content: { 'application/json': { schema: doc.body } } } } : {}),
    },
    responses: {
      ...(status === 204
        ? { 204: { description: 'No content' } }
        : {
            [status]: {
              description: 'Success',
              content: {
                'application/json': { schema: doc.response ?? z.object({ data: z.unknown() }) },
              },
            },
          }),
      400: {
        description: 'Bad request / validation error',
        content: { 'application/json': { schema: errorBodySchema } },
      },
      ...(doc.auth
        ? {
            401: {
              description: 'Unauthorized',
              content: { 'application/json': { schema: errorBodySchema } },
            },
          }
        : {}),
    },
  });
}

const trackIdParam = z.object({ trackId: z.string() });

// auth
route({
  method: 'post',
  path: '/auth/session',
  tag: 'auth',
  summary: 'Verify token, upsert user, return profile',
  auth: true,
  response: envelope(meSchema),
});
route({
  method: 'delete',
  path: '/auth/session',
  tag: 'auth',
  summary: 'End session (stateless)',
  auth: true,
  status: 204,
});

// users
route({
  method: 'get',
  path: '/me',
  tag: 'users',
  summary: 'My profile',
  auth: true,
  response: envelope(meSchema),
});
route({
  method: 'patch',
  path: '/me',
  tag: 'users',
  summary: 'Update my profile',
  auth: true,
  body: updateMeSchema,
  response: envelope(meSchema),
});
route({
  method: 'get',
  path: '/me/stats',
  tag: 'users',
  summary: 'My listening stats',
  auth: true,
  response: envelope(userStatsSchema),
});
route({
  method: 'get',
  path: '/users/{id}',
  tag: 'users',
  summary: 'Public user profile',
  params: idParamSchema,
  response: envelope(userSchema),
});
route({
  method: 'get',
  path: '/users/{id}/playlists',
  tag: 'users',
  summary: 'Public playlists of a user',
  params: idParamSchema,
  query: cursorQuerySchema,
  response: envelope(z.array(playlistSchema), cursorMetaSchema),
});
route({
  method: 'post',
  path: '/users/{id}/follow',
  tag: 'users',
  summary: 'Follow user',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/users/{id}/follow',
  tag: 'users',
  summary: 'Unfollow user',
  auth: true,
  params: idParamSchema,
  status: 204,
});

// artists
route({
  method: 'get',
  path: '/artists',
  tag: 'artists',
  summary: 'List artists',
  query: cursorQuerySchema,
  response: envelope(z.array(artistSchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/artists/{id}',
  tag: 'artists',
  summary: 'Artist detail',
  params: idParamSchema,
  response: envelope(artistSchema),
});
route({
  method: 'get',
  path: '/artists/{id}/top-tracks',
  tag: 'artists',
  summary: 'Artist top tracks',
  params: idParamSchema,
  response: envelope(z.array(trackSchema)),
});
route({
  method: 'get',
  path: '/artists/{id}/albums',
  tag: 'artists',
  summary: 'Artist albums',
  params: idParamSchema,
  query: cursorQuerySchema,
  response: envelope(z.array(albumSchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/artists/{id}/related',
  tag: 'artists',
  summary: 'Related artists',
  params: idParamSchema,
  response: envelope(z.array(artistSchema)),
});
route({
  method: 'post',
  path: '/artists/{id}/follow',
  tag: 'artists',
  summary: 'Follow artist',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/artists/{id}/follow',
  tag: 'artists',
  summary: 'Unfollow artist',
  auth: true,
  params: idParamSchema,
  status: 204,
});

// albums
route({
  method: 'get',
  path: '/albums',
  tag: 'albums',
  summary: 'List albums',
  query: cursorQuerySchema,
  response: envelope(z.array(albumSchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/albums/new-releases',
  tag: 'albums',
  summary: 'New releases',
  response: envelope(z.array(albumSchema)),
});
route({
  method: 'get',
  path: '/albums/{id}',
  tag: 'albums',
  summary: 'Album with tracks',
  params: idParamSchema,
  response: envelope(albumWithTracksSchema),
});

// tracks
route({
  method: 'get',
  path: '/tracks/{id}',
  tag: 'tracks',
  summary: 'Track detail',
  params: idParamSchema,
  response: envelope(trackSchema),
});
route({
  method: 'get',
  path: '/tracks/{id}/waveform',
  tag: 'tracks',
  summary: 'Waveform peaks',
  params: idParamSchema,
  response: envelope(waveformSchema),
});
route({
  method: 'get',
  path: '/tracks/{id}/lyrics',
  tag: 'tracks',
  summary: 'Lyrics',
  params: idParamSchema,
  response: envelope(lyricsSchema),
});

// playlists
route({
  method: 'get',
  path: '/playlists',
  tag: 'playlists',
  summary: 'My playlists',
  auth: true,
  query: cursorQuerySchema,
  response: envelope(z.array(playlistSchema), cursorMetaSchema),
});
route({
  method: 'post',
  path: '/playlists',
  tag: 'playlists',
  summary: 'Create playlist',
  auth: true,
  body: createPlaylistSchema,
  response: envelope(playlistSchema),
  status: 201,
});
route({
  method: 'get',
  path: '/playlists/{id}',
  tag: 'playlists',
  summary: 'Playlist with tracks',
  params: idParamSchema,
  response: envelope(playlistWithTracksSchema),
});
route({
  method: 'patch',
  path: '/playlists/{id}',
  tag: 'playlists',
  summary: 'Update playlist',
  auth: true,
  params: idParamSchema,
  body: updatePlaylistSchema,
  response: envelope(playlistSchema),
});
route({
  method: 'delete',
  path: '/playlists/{id}',
  tag: 'playlists',
  summary: 'Delete playlist',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'post',
  path: '/playlists/{id}/tracks',
  tag: 'playlists',
  summary: 'Add tracks',
  auth: true,
  params: idParamSchema,
  body: addPlaylistTracksSchema,
  response: envelope(playlistWithTracksSchema),
});
route({
  method: 'delete',
  path: '/playlists/{id}/tracks',
  tag: 'playlists',
  summary: 'Remove entries',
  auth: true,
  params: idParamSchema,
  body: removePlaylistTracksSchema,
  response: envelope(playlistWithTracksSchema),
});
route({
  method: 'patch',
  path: '/playlists/{id}/tracks/reorder',
  tag: 'playlists',
  summary: 'Reorder an entry',
  auth: true,
  params: idParamSchema,
  body: reorderPlaylistSchema,
  response: envelope(playlistWithTracksSchema),
});
route({
  method: 'post',
  path: '/playlists/{id}/collaborators',
  tag: 'playlists',
  summary: 'Add collaborator',
  auth: true,
  params: idParamSchema,
  body: addCollaboratorSchema,
  status: 204,
});

// library
route({
  method: 'get',
  path: '/me/library',
  tag: 'library',
  summary: 'My library',
  auth: true,
  response: envelope(librarySchema),
});
route({
  method: 'get',
  path: '/me/library/liked-tracks',
  tag: 'library',
  summary: 'Liked tracks',
  auth: true,
  query: cursorQuerySchema,
  response: envelope(z.array(trackSchema), cursorMetaSchema),
});
route({
  method: 'put',
  path: '/me/library/tracks/{id}',
  tag: 'library',
  summary: 'Like track',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/me/library/tracks/{id}',
  tag: 'library',
  summary: 'Unlike track',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'put',
  path: '/me/library/albums/{id}',
  tag: 'library',
  summary: 'Save album',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/me/library/albums/{id}',
  tag: 'library',
  summary: 'Remove album',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'put',
  path: '/me/library/artists/{id}',
  tag: 'library',
  summary: 'Follow artist (library)',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/me/library/artists/{id}',
  tag: 'library',
  summary: 'Unfollow artist (library)',
  auth: true,
  params: idParamSchema,
  status: 204,
});

// history
route({
  method: 'post',
  path: '/me/history',
  tag: 'history',
  summary: 'Record play event',
  auth: true,
  body: recordPlaySchema,
  response: envelope(z.object({ id: z.string() })),
  status: 201,
});
route({
  method: 'get',
  path: '/me/history',
  tag: 'history',
  summary: 'Play history',
  auth: true,
  query: cursorQuerySchema,
  response: envelope(z.array(historyEntrySchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/me/history/recent',
  tag: 'history',
  summary: 'Continue listening',
  auth: true,
  response: envelope(z.array(continueListeningSchema)),
});

// search
route({
  method: 'get',
  path: '/search',
  tag: 'search',
  summary: 'Grouped search',
  query: searchQuerySchema,
  response: envelope(searchResultsSchema),
});
route({
  method: 'get',
  path: '/search/suggest',
  tag: 'search',
  summary: 'Autocomplete',
  query: suggestQuerySchema,
  response: envelope(z.array(suggestionSchema)),
});

// home
route({
  method: 'get',
  path: '/home',
  tag: 'home',
  summary: 'Personalized home sections',
  auth: true,
  response: envelope(homeSchema),
});

// uploads
route({
  method: 'post',
  path: '/uploads',
  tag: 'uploads',
  summary: 'Upload audio (multipart: file + optional metadata)',
  auth: true,
  body: uploadMetadataSchema,
  response: envelope(uploadSchema),
  status: 202,
});
route({
  method: 'get',
  path: '/uploads/{id}/status',
  tag: 'uploads',
  summary: 'Upload processing status',
  auth: true,
  params: idParamSchema,
  response: envelope(uploadSchema),
});
route({
  method: 'get',
  path: '/me/uploads',
  tag: 'uploads',
  summary: 'My uploads',
  auth: true,
  query: cursorQuerySchema,
  response: envelope(z.array(uploadSchema), cursorMetaSchema),
});
route({
  method: 'delete',
  path: '/uploads/{id}',
  tag: 'uploads',
  summary: 'Delete upload',
  auth: true,
  params: idParamSchema,
  status: 204,
});

// imports
route({
  method: 'post',
  path: '/imports/cloud',
  tag: 'imports',
  summary: 'Start cloud import',
  auth: true,
  body: createImportSchema,
  response: envelope(importJobSchema),
  status: 202,
});
route({
  method: 'get',
  path: '/imports/{id}/status',
  tag: 'imports',
  summary: 'Import job status',
  auth: true,
  params: idParamSchema,
  response: envelope(importJobSchema),
});

// stream
route({
  method: 'get',
  path: '/stream/{trackId}/manifest.m3u8',
  tag: 'stream',
  summary: 'HLS master playlist (signed token query)',
  params: trackIdParam,
  query: z.object({ token: z.string() }),
});
route({
  method: 'get',
  path: '/stream/{trackId}/{quality}/{file}',
  tag: 'stream',
  summary: 'HLS variant playlist / segment',
  params: z.object({
    trackId: z.string(),
    quality: z.enum(['low', 'normal', 'high']),
    file: z.string(),
  }),
  query: z.object({ token: z.string() }),
});

// podcasts / radios
route({
  method: 'get',
  path: '/podcasts',
  tag: 'podcasts',
  summary: 'List podcasts',
  query: cursorQuerySchema,
  response: envelope(z.array(podcastSchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/podcasts/{id}',
  tag: 'podcasts',
  summary: 'Podcast detail',
  params: idParamSchema,
  response: envelope(podcastSchema),
});
route({
  method: 'get',
  path: '/podcasts/{id}/episodes',
  tag: 'podcasts',
  summary: 'Podcast episodes',
  params: idParamSchema,
  query: cursorQuerySchema,
  response: envelope(z.array(episodeSchema), cursorMetaSchema),
});
route({
  method: 'get',
  path: '/radios',
  tag: 'radios',
  summary: 'List radio stations',
  response: envelope(z.array(radioStationSchema)),
});
route({
  method: 'get',
  path: '/radios/{id}',
  tag: 'radios',
  summary: 'Radio station',
  params: idParamSchema,
  response: envelope(radioStationSchema),
});

// recommendations
route({
  method: 'get',
  path: '/recs/daily-mix',
  tag: 'recommendations',
  summary: 'Daily mix',
  auth: true,
  response: envelope(dailyMixSchema),
});
route({
  method: 'get',
  path: '/recs/discover',
  tag: 'recommendations',
  summary: 'Discover new tracks',
  auth: true,
  response: envelope(z.array(trackSchema)),
});
route({
  method: 'get',
  path: '/recs/mood/{mood}',
  tag: 'recommendations',
  summary: 'Mood playlist',
  params: z.object({ mood: moodSchema }),
  response: envelope(z.array(trackSchema)),
});
route({
  method: 'get',
  path: '/recs/track-radio/{trackId}',
  tag: 'recommendations',
  summary: 'Track radio',
  params: trackIdParam,
  response: envelope(z.array(trackSchema)),
});

// social
route({
  method: 'get',
  path: '/feed',
  tag: 'social',
  summary: 'Activity feed',
  auth: true,
  query: cursorQuerySchema,
  response: envelope(z.array(feedEventSchema), cursorMetaSchema),
});
route({
  method: 'post',
  path: '/tracks/{id}/comments',
  tag: 'social',
  summary: 'Comment on track',
  auth: true,
  params: idParamSchema,
  body: createCommentSchema,
  response: envelope(commentSchema),
  status: 201,
});
route({
  method: 'get',
  path: '/tracks/{id}/comments',
  tag: 'social',
  summary: 'Track comments',
  params: idParamSchema,
  query: cursorQuerySchema,
  response: envelope(z.array(commentSchema), cursorMetaSchema),
});
route({
  method: 'delete',
  path: '/comments/{id}',
  tag: 'social',
  summary: 'Delete comment',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'put',
  path: '/comments/{id}/like',
  tag: 'social',
  summary: 'Like comment',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'delete',
  path: '/comments/{id}/like',
  tag: 'social',
  summary: 'Unlike comment',
  auth: true,
  params: idParamSchema,
  status: 204,
});
route({
  method: 'post',
  path: '/sessions',
  tag: 'social',
  summary: 'Create listen-together session',
  auth: true,
  body: z.object({ trackId: z.string().optional() }),
  response: envelope(listenSessionSchema),
  status: 201,
});
route({
  method: 'get',
  path: '/sessions/{id}',
  tag: 'social',
  summary: 'Listen session',
  auth: true,
  params: idParamSchema,
  response: envelope(listenSessionSchema),
});
route({
  method: 'delete',
  path: '/sessions/{id}',
  tag: 'social',
  summary: 'End listen session (host)',
  auth: true,
  params: idParamSchema,
  status: 204,
});

// admin
route({
  method: 'get',
  path: '/admin/stats',
  tag: 'admin',
  summary: 'Platform stats',
  auth: true,
  response: envelope(adminStatsSchema),
});
route({
  method: 'get',
  path: '/admin/users',
  tag: 'admin',
  summary: 'List users (offset)',
  auth: true,
  query: pageQuerySchema,
  response: envelope(z.array(userSchema), pageMetaSchema),
});
route({
  method: 'patch',
  path: '/admin/users/{id}',
  tag: 'admin',
  summary: 'Update user role/premium',
  auth: true,
  params: idParamSchema,
  body: adminUpdateUserSchema,
  response: envelope(userSchema),
});
route({
  method: 'post',
  path: '/admin/users/{id}/ban',
  tag: 'admin',
  summary: 'Ban user',
  auth: true,
  params: idParamSchema,
  body: banUserSchema,
  response: envelope(userSchema),
});
route({
  method: 'delete',
  path: '/admin/users/{id}/ban',
  tag: 'admin',
  summary: 'Unban user',
  auth: true,
  params: idParamSchema,
  response: envelope(userSchema),
});
route({
  method: 'get',
  path: '/admin/uploads',
  tag: 'admin',
  summary: 'All uploads',
  auth: true,
  query: pageQuerySchema,
  response: envelope(z.array(uploadSchema), pageMetaSchema),
});
route({
  method: 'get',
  path: '/admin/jobs',
  tag: 'admin',
  summary: 'Queue job counts',
  auth: true,
});
route({
  method: 'get',
  path: '/admin/logs',
  tag: 'admin',
  summary: 'Audit logs',
  auth: true,
  query: pageQuerySchema,
  response: envelope(z.array(auditLogSchema), pageMetaSchema),
});
route({
  method: 'get',
  path: '/admin/analytics/plays',
  tag: 'admin',
  summary: 'Plays per day (analytics-lite)',
  auth: true,
  query: z.object({ days: z.number().optional() }),
});

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Aurial API',
      version: '1.0.0',
      description:
        'Aurial music streaming API. Success envelope: `{ data, meta? }` — errors: `{ error: { code, message, details? } }`. Cursor pagination via `?cursor=&limit=`.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
