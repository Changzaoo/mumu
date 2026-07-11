import type { SearchQuery, SearchResultsDto, SearchType, SuggestionDto } from '@aurial/shared';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import {
  applyLikedFlags,
  toAlbumDto,
  toArtistDto,
  toPlaylistDto,
  toPodcastDto,
  toRadioDto,
  toTrackDto,
  toUserDto,
} from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { searchRepository } from './search.repository.js';

const EMPTY: SearchResultsDto = {
  query: '',
  correctedQuery: null,
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  podcasts: [],
  radios: [],
  users: [],
  topResult: null,
};

function terms(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

function wants(type: SearchType, target: Exclude<SearchType, 'all'>): boolean {
  return type === 'all' || type === target;
}

/** Rank the "top result" — exact-ish name match wins, then entity priority. */
function pickTopResult(results: SearchResultsDto, q: string): SearchResultsDto['topResult'] {
  const norm = q.trim().toLowerCase();
  const candidates: Array<{
    type: Exclude<SearchType, 'all'>;
    id: string;
    name: string;
    weight: number;
  }> = [
    ...results.artists.map((a) => ({ type: 'artist' as const, id: a.id, name: a.name, weight: 3 })),
    ...results.tracks.map((t) => ({ type: 'track' as const, id: t.id, name: t.title, weight: 2 })),
    ...results.albums.map((a) => ({ type: 'album' as const, id: a.id, name: a.title, weight: 1 })),
    ...results.playlists.map((p) => ({
      type: 'playlist' as const,
      id: p.id,
      name: p.title,
      weight: 0,
    })),
  ];
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    const score = (name === norm ? 100 : name.startsWith(norm) ? 50 : 10) + c.weight;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? { type: best.type, id: best.id } : null;
}

export const searchService = {
  async search(input: SearchQuery, userId?: string): Promise<SearchResultsDto> {
    const { q, type, limit } = input;
    const words = terms(q);
    if (words.length === 0) return { ...EMPTY, query: q };

    const key = cacheKeys.search(q.toLowerCase(), type, limit);
    let results = await cache.getJson<SearchResultsDto>(key);

    if (!results) {
      const [tracks, albums, artists, playlists, podcasts, radios, users] = await Promise.all([
        wants(type, 'track') ? searchRepository.tracks(words, limit) : Promise.resolve([]),
        wants(type, 'album') ? searchRepository.albums(words, limit) : Promise.resolve([]),
        wants(type, 'artist') ? searchRepository.artists(words, limit) : Promise.resolve([]),
        wants(type, 'playlist') ? searchRepository.playlists(words, limit) : Promise.resolve([]),
        wants(type, 'podcast') ? searchRepository.podcasts(words, limit) : Promise.resolve([]),
        wants(type, 'radio') ? searchRepository.radios(words, limit) : Promise.resolve([]),
        wants(type, 'user') ? searchRepository.users(words, limit) : Promise.resolve([]),
      ]);

      // Fallback: thin title matches → widen to artist-name matches.
      let trackRows = tracks;
      if (wants(type, 'track') && trackRows.length < Math.min(3, limit)) {
        const byArtist = await searchRepository.tracksByArtist(words, limit - trackRows.length);
        const seen = new Set(trackRows.map((t) => t.id));
        trackRows = [...trackRows, ...byArtist.filter((t) => !seen.has(t.id))];
      }

      results = {
        query: q,
        correctedQuery: null, // hook for a future spell-corrector
        tracks: trackRows.map((t) => toTrackDto(t)),
        albums: albums.map(toAlbumDto),
        artists: artists.map(toArtistDto),
        playlists: playlists.map(toPlaylistDto),
        podcasts: podcasts.map(toPodcastDto),
        radios: radios.map(toRadioDto),
        users: users.map(toUserDto),
        topResult: null,
      };
      results.topResult = pickTopResult(results, q);
      await cache.setJson(key, results, cacheTtl.search);
    }

    if (userId && results.tracks.length > 0) {
      const likedSet = await libraryRepository.likedTrackIdSet(
        userId,
        results.tracks.map((t) => t.id),
      );
      return { ...results, tracks: applyLikedFlags(results.tracks, likedSet) };
    }
    return results;
  },

  async suggest(q: string): Promise<SuggestionDto[]> {
    const [artists, tracks, albums] = await Promise.all([
      searchRepository.artistPrefix(q, 3),
      searchRepository.trackPrefix(q, 4),
      searchRepository.albumPrefix(q, 3),
    ]);
    return [
      ...artists.map((a): SuggestionDto => ({
        text: a.name,
        type: 'artist',
        id: a.id,
        imageUrl: a.imageUrl,
      })),
      ...tracks.map((t): SuggestionDto => ({
        text: t.title,
        type: 'track',
        id: t.id,
        imageUrl: t.coverUrl,
      })),
      ...albums.map((a): SuggestionDto => ({
        text: a.title,
        type: 'album',
        id: a.id,
        imageUrl: a.coverUrl,
      })),
    ].slice(0, 8);
  },
};
