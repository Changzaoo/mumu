/**
 * Browse feature — discover / radios / podcasts hooks.
 *
 * Endpoints per ARCHITECTURE §4: /albums/new-releases, /recs/mood/:mood,
 * /radios, /podcasts, /podcasts/:id, /podcasts/:id/episodes. "Trending" has
 * no dedicated endpoint — it is derived from the /home sections payload.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  AlbumDto,
  EpisodeDto,
  HomeDto,
  HomeSectionDto,
  Mood,
  PodcastDto,
  RadioStationDto,
  TrackDto,
} from '@aurial/shared';
import { api } from '@/lib/api';

export function useNewReleases(): UseQueryResult<AlbumDto[]> {
  return useQuery({
    queryKey: ['new-releases'],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<AlbumDto[]>('/albums/new-releases')).data,
  });
}

/**
 * Trending section extracted from GET /home (shares the ['home'] cache).
 * Returns the section (or null when the server sent none).
 */
export function useTrending(): UseQueryResult<HomeSectionDto | null> {
  return useQuery({
    queryKey: ['home'],
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<HomeDto>('/home')).data,
    select: (home) =>
      home.sections.find(
        (section) => section.id === 'trending' || /em alta|trending/i.test(section.title),
      ) ?? null,
  });
}

export function useMoodTracks(mood: Mood | null): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['mood', mood],
    enabled: mood !== null,
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<TrackDto[]>(`/recs/mood/${mood}`)).data,
  });
}

export function useRadios(): UseQueryResult<RadioStationDto[]> {
  return useQuery({
    queryKey: ['radios'],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<RadioStationDto[]>('/radios')).data,
  });
}

export function usePodcasts(): UseQueryResult<PodcastDto[]> {
  return useQuery({
    queryKey: ['podcasts'],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<PodcastDto[]>('/podcasts')).data,
  });
}

export function usePodcast(id: string): UseQueryResult<PodcastDto> {
  return useQuery({
    queryKey: ['podcast', id],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<PodcastDto>(`/podcasts/${id}`)).data,
  });
}

export function usePodcastEpisodes(id: string): UseQueryResult<EpisodeDto[]> {
  return useQuery({
    queryKey: ['podcast-episodes', id],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<EpisodeDto[]>(`/podcasts/${id}/episodes`)).data,
  });
}

// ── Mappers — playback expects TrackDto-shaped objects ─────────

/** Live radio → TrackDto shape (durationMs 0 = live stream, no seek). */
export function radioToTrack(radio: RadioStationDto): TrackDto {
  return {
    id: `radio:${radio.id}`,
    title: radio.name,
    durationMs: 0,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: radio.imageUrl,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: null,
    artists: [],
    streamUrl: radio.streamUrl,
    uploadedByUserId: null,
  };
}

/** Podcast episode → TrackDto shape (podcast title shown as "artist" slot via album). */
export function episodeToTrack(
  episode: EpisodeDto,
  podcast?: Pick<PodcastDto, 'id' | 'title'>,
): TrackDto {
  return {
    id: `episode:${episode.id}`,
    title: episode.title,
    durationMs: episode.durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: episode.coverUrl,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: podcast
      ? { id: podcast.id, title: podcast.title, slug: podcast.id, coverUrl: episode.coverUrl }
      : null,
    artists: [],
    streamUrl: episode.streamUrl,
    uploadedByUserId: null,
  };
}
