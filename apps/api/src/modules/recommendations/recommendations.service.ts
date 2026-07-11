import type { DailyMixDto, Mood, TrackDto } from '@aurial/shared';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import { applyLikedFlags } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { recommendationEngine } from './recommendations.engine.js';

async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const hit = await cache.getJson<T>(key);
  if (hit) return hit;
  const value = await produce();
  await cache.setJson(key, value, cacheTtl.recs);
  return value;
}

async function withLikes(tracks: TrackDto[], userId?: string): Promise<TrackDto[]> {
  if (!userId || tracks.length === 0) return tracks;
  const likedSet = await libraryRepository.likedTrackIdSet(
    userId,
    tracks.map((t) => t.id),
  );
  return applyLikedFlags(tracks, likedSet);
}

export const recommendationsService = {
  async dailyMix(userId: string): Promise<DailyMixDto> {
    const mix = await cached(cacheKeys.recs('daily-mix', userId), async () => {
      const tracks = await recommendationEngine.dailyMix(userId, 30);
      return {
        id: `daily-mix-${new Date().toISOString().slice(0, 10)}`,
        title: 'Daily Mix',
        description: 'Fresh picks from your favorite genres and artists',
        coverUrl: tracks.find((t) => t.coverUrl !== null)?.coverUrl ?? null,
        tracks,
      } satisfies DailyMixDto;
    });
    return { ...mix, tracks: await withLikes(mix.tracks, userId) };
  },

  async discover(userId: string): Promise<TrackDto[]> {
    const tracks = await cached(cacheKeys.recs('discover', userId), () =>
      recommendationEngine.discover(userId, 30),
    );
    return withLikes(tracks, userId);
  },

  async byMood(mood: Mood, userId?: string): Promise<TrackDto[]> {
    const tracks = await cached(cacheKeys.recs('mood', mood), () =>
      recommendationEngine.byMood(mood, 30),
    );
    return withLikes(tracks, userId);
  },

  async trackRadio(trackId: string, userId?: string): Promise<TrackDto[]> {
    const tracks = await cached(cacheKeys.recs('track-radio', trackId), () =>
      recommendationEngine.trackRadio(trackId, 30),
    );
    return withLikes(tracks, userId);
  },
};
