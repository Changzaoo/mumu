import { z } from 'zod';
import {
  albumSchema,
  artistSchema,
  podcastSchema,
  radioStationSchema,
  trackSchema,
} from './music.js';
import { playlistSchema } from './playlist.js';
import { userSchema } from './user.js';

export const searchTypeSchema = z.enum([
  'all',
  'track',
  'album',
  'artist',
  'playlist',
  'podcast',
  'radio',
  'user',
]);
export type SearchType = z.infer<typeof searchTypeSchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: searchTypeSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultsSchema = z.object({
  query: z.string(),
  /** Server-side spelling suggestion ("did you mean"). */
  correctedQuery: z.string().nullable(),
  tracks: z.array(trackSchema),
  albums: z.array(albumSchema),
  artists: z.array(artistSchema),
  playlists: z.array(playlistSchema),
  podcasts: z.array(podcastSchema),
  radios: z.array(radioStationSchema),
  users: z.array(userSchema),
  topResult: z
    .object({
      type: searchTypeSchema,
      id: z.string(),
    })
    .nullable(),
});
export type SearchResultsDto = z.infer<typeof searchResultsSchema>;

export const suggestQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

export const suggestionSchema = z.object({
  text: z.string(),
  type: searchTypeSchema,
  id: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type SuggestionDto = z.infer<typeof suggestionSchema>;
