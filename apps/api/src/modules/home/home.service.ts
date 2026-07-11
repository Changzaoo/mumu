import type { HomeDto, HomeSectionDto, HomeSectionItem, TrackDto } from '@aurial/shared';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import {
  toAlbumDto,
  toArtistDto,
  toPodcastDto,
  toRadioDto,
  toTrackDto,
} from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { historyService } from '../history/history.service.js';
import { homeRepository } from './home.repository.js';

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const trackItems = (tracks: TrackDto[]): HomeSectionItem[] =>
  tracks.map((t) => ({ kind: 'track' as const, item: t }));

function section(
  id: string,
  title: string,
  subtitle: string | null,
  layout: HomeSectionDto['layout'],
  items: HomeSectionItem[],
): HomeSectionDto | null {
  return items.length === 0 ? null : { id, title, subtitle, layout, items };
}

export const homeService = {
  async getHome(userId: string): Promise<HomeDto> {
    const key = cacheKeys.home(userId);
    const cached = await cache.getJson<HomeDto>(key);
    if (cached) return this.overlayLikes(cached, userId);

    const [
      continueListening,
      recentIds,
      trending,
      newReleases,
      artists,
      recommendedRaw,
      radios,
      podcasts,
    ] = await Promise.all([
      historyService.recent(userId, 8),
      homeRepository.recentTrackIds(userId, 12),
      homeRepository.trending(12),
      homeRepository.newReleases(12),
      homeRepository.popularArtists(12),
      homeRepository.recommendedByGenres(userId, [], 12),
      homeRepository.radios(8),
      homeRepository.podcasts(8),
    ]);

    const recentRows = await homeRepository.tracksByIds(recentIds);
    // Preserve recency order lost by the IN query.
    const byId = new Map(recentRows.map((r) => [r.id, r]));
    const recentTracks = recentIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => toTrackDto(r));

    const recentIdSet = new Set(recentIds);
    const recommended = recommendedRaw
      .filter((t) => !recentIdSet.has(t.id))
      .map((t) => toTrackDto(t));

    const home: HomeDto = {
      greeting: greetingFor(new Date().getHours()),
      continueListening,
      sections: [
        section('recently-played', 'Recently played', null, 'carousel', trackItems(recentTracks)),
        section(
          'recommended',
          'Made for you',
          'Based on what you listen to',
          'carousel',
          trackItems(recommended),
        ),
        section(
          'new-releases',
          'New releases',
          null,
          'carousel',
          newReleases.map((a) => ({ kind: 'album' as const, item: toAlbumDto(a) })),
        ),
        section(
          'trending',
          'Trending now',
          'What everyone is playing',
          'carousel',
          trackItems(trending.map((t) => toTrackDto(t))),
        ),
        section(
          'popular-artists',
          'Popular artists',
          null,
          'carousel',
          artists.map((a) => ({ kind: 'artist' as const, item: toArtistDto(a) })),
        ),
        section(
          'radios',
          'Live radios',
          null,
          'grid',
          radios.map((r) => ({ kind: 'radio' as const, item: toRadioDto(r) })),
        ),
        section(
          'podcasts',
          'Podcasts',
          null,
          'grid',
          podcasts.map((p) => ({ kind: 'podcast' as const, item: toPodcastDto(p) })),
        ),
      ].filter((s): s is HomeSectionDto => s !== null),
    };

    await cache.setJson(key, home, cacheTtl.home);
    return this.overlayLikes(home, userId);
  },

  /** Personal like flags are applied after the (user-scoped but flag-less) cache. */
  async overlayLikes(home: HomeDto, userId: string): Promise<HomeDto> {
    const trackIds = new Set<string>();
    for (const cl of home.continueListening) trackIds.add(cl.track.id);
    for (const s of home.sections) {
      for (const item of s.items) if (item.kind === 'track') trackIds.add(item.item.id);
    }
    if (trackIds.size === 0) return home;
    const likedSet = await libraryRepository.likedTrackIdSet(userId, [...trackIds]);
    return {
      ...home,
      continueListening: home.continueListening.map((cl) => ({
        ...cl,
        track: { ...cl.track, isLiked: likedSet.has(cl.track.id) },
      })),
      sections: home.sections.map((s) => ({
        ...s,
        items: s.items.map((item) =>
          item.kind === 'track'
            ? { ...item, item: { ...item.item, isLiked: likedSet.has(item.item.id) } }
            : item,
        ),
      })),
    };
  },
};
