/**
 * Library feature — API hooks.
 *
 * Foundation slice (`usePlaylistsNav`) + the pages slice: library snapshot,
 * liked tracks (infinite), like/unlike mutations with optimistic cache
 * updates, history (infinite) and user uploads.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type {
  AlbumDto,
  ArtistDto,
  CreatePlaylistInput,
  HistoryEntryDto,
  ImportConfigDto,
  LibraryDto,
  PlaylistDto,
  TrackDto,
  UploadDto,
} from '@aurial/shared';
import { useAuthUser } from '@/hooks/useAuthUser';
import { api } from '@/lib/api';
import * as localPlaylists from '@/lib/local/localPlaylists';
import type { LocalPlaylist } from '@/lib/local/localPlaylists';
import * as localLikes from '@/lib/local/localLikes';
import * as localHistory from '@/lib/local/localHistory';

const EMPTY_LIBRARY: LibraryDto = {
  playlists: [],
  likedTracksCount: 0,
  albums: [],
  artists: [],
};

/** Stable empty snapshot for useSyncExternalStore (avoids re-render loops). */
const NO_LOCAL_PLAYLISTS: LocalPlaylist[] = [];

/** Reactive local playlists, mapped to the central PlaylistDto shape. */
export function useLocalPlaylists(): PlaylistDto[] {
  const raw = useSyncExternalStore(
    localPlaylists.subscribe,
    localPlaylists.list,
    () => NO_LOCAL_PLAYLISTS,
  );
  return useMemo(() => raw.map(localPlaylists.toPlaylistDto), [raw]);
}

/**
 * User playlists for the Sidebar nav. Gracefully resolves to an empty list
 * when signed out / API unreachable (401 must never break the shell).
 */
export function usePlaylistsNav(): { playlists: PlaylistDto[]; isLoading: boolean } {
  const { user, loading } = useAuthUser();
  const local = useLocalPlaylists();

  const query = useQuery({
    queryKey: ['library'],
    enabled: !loading,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<LibraryDto> => {
      try {
        return (await api.get<LibraryDto>('/me/library')).data;
      } catch {
        // Signed out, demo mode or API offline — the sidebar just shows nothing.
        return EMPTY_LIBRARY;
      }
    },
  });

  return {
    // Local (on-device) playlists first, then any server ones.
    playlists: [...local, ...(query.data?.playlists ?? [])],
    isLoading: loading || (Boolean(user) && query.isLoading),
  };
}

/**
 * Full library snapshot (LibraryPage). Degrades to an empty library when the
 * central API is unreachable (P2P topology) instead of throwing, so the page
 * still renders local playlists and downloads rather than an error screen.
 */
export function useLibrary(): UseQueryResult<LibraryDto> {
  return useQuery({
    queryKey: ['library'],
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return (await api.get<LibraryDto>('/me/library')).data;
      } catch {
        return EMPTY_LIBRARY;
      }
    },
  });
}

// ── Cursor-paginated lists ──────────────────────────────────────

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type LikedTracksResult = UseInfiniteQueryResult<InfiniteData<CursorPage<TrackDto>>>;

export function useLikedTracks(): LikedTracksResult {
  return useInfiniteQuery({
    queryKey: ['liked-tracks'],
    initialPageParam: undefined as string | undefined,
    // Likes live on-device — one local page, no network.
    queryFn: (): Promise<CursorPage<TrackDto>> =>
      Promise.resolve({ items: localLikes.list(), nextCursor: null }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export type HistoryResult = UseInfiniteQueryResult<InfiniteData<CursorPage<HistoryEntryDto>>>;

export function useHistory(): HistoryResult {
  return useInfiniteQuery({
    queryKey: ['history'],
    initialPageParam: undefined as string | undefined,
    // History lives on-device — one local page, no network.
    queryFn: (): Promise<CursorPage<HistoryEntryDto>> =>
      Promise.resolve({ items: localHistory.list(), nextCursor: null }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// ── Playlist creation ───────────────────────────────────────────

/**
 * Creates an on-device playlist, then navigates straight to it. Stored locally
 * (localStorage) — no central backend needed, so it works in the P2P topology.
 */
export function useCreatePlaylist(): UseMutationResult<PlaylistDto, Error, CreatePlaylistInput> {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: CreatePlaylistInput) =>
      Promise.resolve(localPlaylists.toPlaylistDto(localPlaylists.create(input.title))),
    onSuccess: (playlist) => {
      toast('Playlist criada');
      void navigate(`/playlist/${playlist.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
}

// ── Likes (tracks / albums / artists) — optimistic ─────────────

export interface ToggleLikeTrackInput {
  track: TrackDto;
  liked: boolean;
}

function patchLikedTracksCache(
  data: InfiniteData<CursorPage<TrackDto>> | undefined,
  input: ToggleLikeTrackInput,
): InfiniteData<CursorPage<TrackDto>> | undefined {
  if (!data) return data;
  if (!input.liked) {
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((t) => t.id !== input.track.id),
      })),
    };
  }
  const first = data.pages[0];
  if (!first || first.items.some((t) => t.id === input.track.id)) return data;
  return {
    ...data,
    pages: [
      { ...first, items: [{ ...input.track, isLiked: true }, ...first.items] },
      ...data.pages.slice(1),
    ],
  };
}

export function useToggleLikeTrack(): UseMutationResult<
  void,
  Error,
  ToggleLikeTrackInput,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ track, liked }: ToggleLikeTrackInput) => {
      localLikes.toggle(track, liked); // on-device, synchronous, never fails
      return Promise.resolve();
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['liked-tracks'] });
      const previousLiked = queryClient.getQueryData<InfiniteData<CursorPage<TrackDto>>>([
        'liked-tracks',
      ]);
      queryClient.setQueryData<InfiniteData<CursorPage<TrackDto>>>(['liked-tracks'], (old) =>
        patchLikedTracksCache(old, input),
      );
      queryClient.setQueryData<LibraryDto>(['library'], (old) =>
        old
          ? {
              ...old,
              likedTracksCount: Math.max(0, old.likedTracksCount + (input.liked ? 1 : -1)),
            }
          : old,
      );
      return { previousLiked };
    },
    onError: (_error, _input, context) => {
      const ctx = context as { previousLiked?: InfiniteData<CursorPage<TrackDto>> } | undefined;
      if (ctx?.previousLiked) queryClient.setQueryData(['liked-tracks'], ctx.previousLiked);
      toast.error('Não foi possível atualizar as curtidas.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['liked-tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

export interface ToggleLikeAlbumInput {
  album: AlbumDto;
  liked: boolean;
}

export function useToggleLikeAlbum(): UseMutationResult<
  void,
  Error,
  ToggleLikeAlbumInput,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ album, liked }: ToggleLikeAlbumInput) => {
      if (liked) await api.put<void>(`/me/library/albums/${album.id}`);
      else await api.del(`/me/library/albums/${album.id}`);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['library'] });
      const previous = queryClient.getQueryData<LibraryDto>(['library']);
      queryClient.setQueryData<LibraryDto>(['library'], (old) => {
        if (!old) return old;
        const albums = input.liked
          ? old.albums.some((a) => a.id === input.album.id)
            ? old.albums
            : [input.album, ...old.albums]
          : old.albums.filter((a) => a.id !== input.album.id);
        return { ...old, albums };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      const ctx = context as { previous?: LibraryDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['library'], ctx.previous);
      toast.error('Não foi possível atualizar a biblioteca.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['library'] }),
  });
}

export interface ToggleLikeArtistInput {
  artist: ArtistDto;
  liked: boolean;
}

export function useToggleLikeArtist(): UseMutationResult<
  void,
  Error,
  ToggleLikeArtistInput,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ artist, liked }: ToggleLikeArtistInput) => {
      if (liked) await api.put<void>(`/me/library/artists/${artist.id}`);
      else await api.del(`/me/library/artists/${artist.id}`);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['library'] });
      const previous = queryClient.getQueryData<LibraryDto>(['library']);
      queryClient.setQueryData<LibraryDto>(['library'], (old) => {
        if (!old) return old;
        const artists = input.liked
          ? old.artists.some((a) => a.id === input.artist.id)
            ? old.artists
            : [input.artist, ...old.artists]
          : old.artists.filter((a) => a.id !== input.artist.id);
        return { ...old, artists };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      const ctx = context as { previous?: LibraryDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['library'], ctx.previous);
      toast.error('Não foi possível atualizar a biblioteca.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['library'] }),
  });
}

/**
 * Page-level like state for track lists coming from arbitrary caches
 * (search, album, playlist…): server flag + local optimistic overrides.
 */
export interface TrackLikes {
  isLiked: (track: TrackDto) => boolean;
  toggle: (track: TrackDto, liked: boolean) => void;
}

export function useTrackLikes(): TrackLikes {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const mutation = useToggleLikeTrack();
  // Re-render when likes change anywhere (kept in sync across pages).
  useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);

  return {
    isLiked: (track) => overrides[track.id] ?? localLikes.has(track.id),
    toggle: (track, liked) => {
      setOverrides((old) => ({ ...old, [track.id]: liked }));
      mutation.mutate(
        { track, liked },
        {
          onError: () => setOverrides((old) => ({ ...old, [track.id]: !liked })),
        },
      );
    },
  };
}

// ── Uploads ─────────────────────────────────────────────────────

export function useUploads(): UseQueryResult<UploadDto[]> {
  return useQuery({
    queryKey: ['uploads'],
    queryFn: async () => (await api.get<UploadDto[]>('/me/uploads')).data,
  });
}

/** Polls processing status while an upload is QUEUED/PROBING/TRANSCODING/ANALYZING. */
export function useUploadStatus(upload: UploadDto): UseQueryResult<UploadDto> {
  const processing = upload.status !== 'READY' && upload.status !== 'FAILED';
  return useQuery({
    queryKey: ['upload-status', upload.id],
    enabled: processing,
    initialData: upload,
    refetchInterval: processing ? 2_000 : false,
    queryFn: async () => (await api.get<UploadDto>(`/uploads/${upload.id}/status`)).data,
  });
}

// ── Link import (self-hosted yt-dlp) ────────────────────────────

/** Whether this server exposes the link importer, and which hosts it accepts. */
export function useImportConfig(): UseQueryResult<ImportConfigDto> {
  return useQuery({
    queryKey: ['import-config'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ImportConfigDto> => {
      try {
        return (await api.get<ImportConfigDto>('/imports/config')).data;
      } catch {
        // API offline / signed out / feature absent — just hide the importer.
        return { linkImportEnabled: false, hosts: [] };
      }
    },
  });
}

/** Queue a link import; the returned pending upload flows into the uploads list. */
export function useLinkImport(): UseMutationResult<UploadDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => (await api.post<UploadDto>('/imports/link', { url })).data,
    onSuccess: (upload) => {
      queryClient.setQueryData<UploadDto[]>(['uploads'], (old) =>
        old ? [upload, ...old] : [upload],
      );
      void queryClient.invalidateQueries({ queryKey: ['uploads'] });
      toast('Baixando do link — processando');
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useDeleteUpload(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uploadId: string) => {
      await api.del(`/uploads/${uploadId}`);
    },
    onSuccess: (_data, uploadId) => {
      queryClient.setQueryData<UploadDto[]>(['uploads'], (old) =>
        old?.filter((u) => u.id !== uploadId),
      );
      toast('Upload removido');
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['uploads'] }),
  });
}
