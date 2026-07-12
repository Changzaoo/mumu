import { z } from 'zod';

export const artistSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  bio: z.string().nullable(),
  verified: z.boolean(),
  monthlyListeners: z.number().int(),
  followersCount: z.number().int(),
  genres: z.array(z.string()),
  /** Present only when the request is authenticated. */
  isFollowing: z.boolean().optional(),
});
export type ArtistDto = z.infer<typeof artistSchema>;

export const albumTypeSchema = z.enum(['ALBUM', 'SINGLE', 'EP', 'COMPILATION']);

export const albumSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  type: albumTypeSchema,
  coverUrl: z.string().nullable(),
  dominantColor: z.string().nullable(),
  releaseDate: z.string().nullable(),
  trackCount: z.number().int(),
  durationMs: z.number().int(),
  artists: z.array(artistSchema.pick({ id: true, name: true, slug: true, imageUrl: true })),
  genres: z.array(z.string()),
});
export type AlbumDto = z.infer<typeof albumSchema>;

export const trackSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMs: z.number().int(),
  trackNumber: z.number().int().nullable(),
  discNumber: z.number().int().nullable(),
  explicit: z.boolean(),
  playsCount: z.number().int(),
  coverUrl: z.string().nullable(),
  dominantColor: z.string().nullable(),
  /** Integrated loudness (LUFS) for ReplayGain — null until processed. */
  loudnessLufs: z.number().nullable(),
  isLiked: z.boolean().optional(),
  album: albumSchema.pick({ id: true, title: true, slug: true, coverUrl: true }).nullable(),
  artists: z.array(artistSchema.pick({ id: true, name: true, slug: true, imageUrl: true })),
  /** Where playback should request audio from (adaptive HLS). */
  streamUrl: z.string().nullable(),
  /** Single-file audio URL for offline download (auth required); null when unavailable. */
  downloadUrl: z.string().nullable().optional(),
  /**
   * True for stream-only 30s preview clips (e.g. Apple/iTunes): never
   * downloadable, offline-cached or P2P-shareable. `downloadUrl` is always null.
   */
  previewOnly: z.boolean().optional(),
  /** Primary genre from the catalog source — used for community trending buckets. */
  genre: z.string().nullable().optional(),
  uploadedByUserId: z.string().nullable(),
});
export type TrackDto = z.infer<typeof trackSchema>;

export const albumWithTracksSchema = albumSchema.extend({
  tracks: z.array(trackSchema),
});
export type AlbumWithTracksDto = z.infer<typeof albumWithTracksSchema>;

export const waveformSchema = z.object({
  trackId: z.string(),
  peaks: z.array(z.number().min(0).max(1)),
});
export type WaveformDto = z.infer<typeof waveformSchema>;

export const lyricsSchema = z.object({
  trackId: z.string(),
  synced: z.boolean(),
  /** Synced: [{ timeMs, text }]; plain: single item with timeMs 0. */
  lines: z.array(z.object({ timeMs: z.number(), text: z.string() })),
  source: z.string().nullable(),
});
export type LyricsDto = z.infer<typeof lyricsSchema>;

export const podcastSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  coverUrl: z.string().nullable(),
  description: z.string().nullable(),
  episodeCount: z.number().int(),
});
export type PodcastDto = z.infer<typeof podcastSchema>;

export const episodeSchema = z.object({
  id: z.string(),
  podcastId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  durationMs: z.number().int(),
  publishedAt: z.string(),
  streamUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export type EpisodeDto = z.infer<typeof episodeSchema>;

export const radioStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  streamUrl: z.string(),
  imageUrl: z.string().nullable(),
  genre: z.string().nullable(),
  country: z.string().nullable(),
  isLive: z.boolean(),
});
export type RadioStationDto = z.infer<typeof radioStationSchema>;
