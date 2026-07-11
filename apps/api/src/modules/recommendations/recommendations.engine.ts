import type { Mood, TrackDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { toTrackDto, type TrackRow } from '../shared/mappers.js';
import { recommendationsRepository } from './recommendations.repository.js';

/**
 * Contract kept deliberately narrow so a future ML service can be dropped in:
 * implement this interface, swap the export at the bottom, done.
 */
export interface RecommendationEngine {
  dailyMix(userId: string, limit: number): Promise<TrackDto[]>;
  discover(userId: string, limit: number): Promise<TrackDto[]>;
  byMood(mood: Mood, limit: number): Promise<TrackDto[]>;
  trackRadio(seedTrackId: string, limit: number): Promise<TrackDto[]>;
}

/** Mood → genre slugs produced by the seed; unknown slugs simply match nothing. */
const MOOD_GENRES: Record<Mood, string[]> = {
  chill: ['lo-fi', 'ambient', 'jazz'],
  focus: ['ambient', 'classical', 'lo-fi'],
  workout: ['electronic', 'hip-hop', 'rock'],
  gaming: ['electronic', 'synthwave', 'rock'],
  lofi: ['lo-fi'],
  party: ['pop', 'electronic', 'hip-hop'],
  sleep: ['ambient', 'classical'],
  romance: ['jazz', 'pop', 'mpb'],
  sad: ['indie', 'mpb', 'classical'],
  happy: ['pop', 'indie', 'mpb'],
};

function dedupe(rows: TrackRow[]): TrackRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** Deterministic-ish shuffle keyed by day so mixes feel fresh but stable. */
function daySeededSort<T extends { id: string }>(rows: T[]): T[] {
  const day = new Date().toISOString().slice(0, 10);
  const score = (id: string): number => {
    let h = 0;
    const s = `${day}:${id}`;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  };
  return [...rows].sort((a, b) => score(a.id) - score(b.id));
}

class HeuristicRecommendationEngine implements RecommendationEngine {
  async dailyMix(userId: string, limit: number): Promise<TrackDto[]> {
    const taste = await recommendationsRepository.tasteProfile(userId);
    if (taste.topGenreIds.length === 0 && taste.topArtistIds.length === 0) {
      const trending = await recommendationsRepository.trending(limit);
      return trending.map((t) => toTrackDto(t));
    }
    const [byArtists, byGenres] = await Promise.all([
      recommendationsRepository.tracksByArtists(
        taste.topArtistIds,
        taste.recentTrackIds,
        Math.ceil(limit / 2),
      ),
      recommendationsRepository.tracksByGenres(taste.topGenreIds, taste.recentTrackIds, limit),
    ]);
    return daySeededSort(dedupe([...byArtists, ...byGenres]))
      .slice(0, limit)
      .map((t) => toTrackDto(t));
  }

  async discover(userId: string, limit: number): Promise<TrackDto[]> {
    const taste = await recommendationsRepository.tasteProfile(userId);
    const rows = await recommendationsRepository.discoverTracks(
      taste.topArtistIds,
      taste.recentTrackIds,
      limit * 2,
    );
    return daySeededSort(rows)
      .slice(0, limit)
      .map((t) => toTrackDto(t));
  }

  async byMood(mood: Mood, limit: number): Promise<TrackDto[]> {
    const genres = await recommendationsRepository.genresBySlugs(MOOD_GENRES[mood]);
    if (genres.length === 0) {
      const trending = await recommendationsRepository.trending(limit);
      return trending.map((t) => toTrackDto(t));
    }
    const rows = await recommendationsRepository.tracksByGenres(
      genres.map((g) => g.id),
      [],
      limit * 2,
    );
    return daySeededSort(rows)
      .slice(0, limit)
      .map((t) => toTrackDto(t));
  }

  async trackRadio(seedTrackId: string, limit: number): Promise<TrackDto[]> {
    const seed = await recommendationsRepository.trackSeed(seedTrackId);
    if (!seed) throw new NotFoundError('Track');
    const [sameArtists, sameGenres] = await Promise.all([
      recommendationsRepository.tracksByArtists(
        seed.artistIds,
        [seedTrackId],
        Math.ceil(limit / 2),
      ),
      seed.genreIds.length > 0
        ? recommendationsRepository.tracksByGenres(seed.genreIds, [seedTrackId], limit)
        : Promise.resolve([]),
    ]);
    return dedupe([...sameArtists, ...sameGenres])
      .slice(0, limit)
      .map((t) => toTrackDto(t));
  }
}

export const recommendationEngine: RecommendationEngine = new HeuristicRecommendationEngine();
