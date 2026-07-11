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
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type {
  AlbumDto,
  ArtistDto,
  CreatePlaylistInput,
  CursorMeta,
  HistoryEntryDto,
  LibraryDto,
  PlaylistDto,
  TrackDto,
  UploadDto,
} from '@aurial/shared';
import { useAuthUser } from '@/hooks/useAuthUser';
import { api } from '@/lib/api';

const EMPTY_LIBRARY: LibraryDto = {
  playlists: [],
  likedTracksCount: 0,
  albums: [],
  artists: [],
};

/**
 * User playlists for the Sidebar nav. Gracefully resolves to an empty list
 * when signed out / API unreachable (401 must never break the shell).
 */
export function usePlaylistsNav(): { playlists: PlaylistDto[]; isLoading: boolean } {
  const { user, loading } = useAuthUser();

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
    playlists: query.data?.playlists ?? [],
    isLoading: loading || (Boolean(user) && query.isLoading),
  };
}

/** Full library snapshot (LibraryPage). Throws on failure — page shows retry. */
export function useLibrary(): UseQueryResult<LibraryDto> {
  return useQuery({
    queryKey: ['library'],
    staleTime: 60_000,
    queryFn: async () => (await api.get<LibraryDto>('/me/library')).data,
  });
}

// ── Cursor-paginated lists ──────────────────────────────────────

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

async function fetchCursorPage<T>(
  path: string,
  cursor: string | undefined,
): Promise<CursorPage<T>> {
  const { data, meta } = await api.get<T[], CursorMeta>(path, {
    query: { cursor, limit: 50 },
  });
  return { items: data, nextCursor: meta?.nextCursor ?? null };
}

export type LikedTracksResult = UseInfiniteQueryResult<InfiniteData<CursorPage<TrackDto>>>;

export function useLikedTracks(): LikedTracksResult {
  return useInfiniteQuery({
    queryKey: ['liked-tracks'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchCursorPage<TrackDto>('/me/library/liked-tracks', pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export type HistoryResult = UseInfiniteQueryResult<InfiniteData<CursorPage<HistoryEntryDto>>>;

export function useHistory(): HistoryResult {
  return useInfiniteQuery({
    queryKey: ['history'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchCursorPage<HistoryEntryDto>('/me/history', pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// ── Playlist creation ───────────────────────────────────────────

/** Creates a playlist, then navigates straight to it (optimistic nav). */
export function useCreatePlaylist(): UseMutationResult<PlaylistDto, Error, CreatePlaylistInput> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (input: CreatePlaylistInput) =>
      (await api.post<PlaylistDto>('/playlists', input)).data,
    onSuccess: (playlist) => {
      queryClient.setQueryData<LibraryDto>(['library'], (old) =>
        old ? { ...old, playlists: [playlist, ...old.playlists] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['library'] });
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
    mutationFn: async ({ track, liked }: ToggleLikeTrackInput) => {
      if (liked) await api.put<void>(`/me/library/tracks/${track.id}`);
      else await api.del(`/me/library/tracks/${track.id}`);
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

  return {
    isLiked: (track) => overrides[track.id] ?? track.isLiked ?? false,
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
