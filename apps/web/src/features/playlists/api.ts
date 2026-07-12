/**
 * Playlists feature — detail + mutation hooks.
 * Reorder is optimistic (PATCH /playlists/:id/tracks/reorder).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type {
  PlaylistDto,
  PlaylistWithTracksDto,
  ReorderPlaylistInput,
  UpdatePlaylistInput,
} from '@aurial/shared';
import { api } from '@/lib/api';
import * as localPlaylists from '@/lib/local/localPlaylists';

export function usePlaylist(id: string): UseQueryResult<PlaylistWithTracksDto> {
  return useQuery({
    queryKey: ['playlist', id],
    // Local playlists render straight from on-device storage — no network.
    ...(localPlaylists.isLocalPlaylistId(id) ? { staleTime: 0 } : {}),
    queryFn: async () => {
      if (localPlaylists.isLocalPlaylistId(id)) {
        const playlist = localPlaylists.get(id);
        if (!playlist) throw new Error('Playlist não encontrada.');
        return localPlaylists.toPlaylistWithTracksDto(playlist);
      }
      return (await api.get<PlaylistWithTracksDto>(`/playlists/${id}`)).data;
    },
  });
}

export function useUpdatePlaylist(
  id: string,
): UseMutationResult<PlaylistDto, Error, UpdatePlaylistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePlaylistInput) =>
      (await api.patch<PlaylistDto>(`/playlists/${id}`, input)).data,
    onSuccess: (updated) => {
      queryClient.setQueryData<PlaylistWithTracksDto>(['playlist', id], (old) =>
        old ? { ...old, ...updated } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      toast('Playlist atualizada');
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useAddTracks(id: string): UseMutationResult<void, Error, string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trackIds: string[]) => {
      await api.post(`/playlists/${id}/tracks`, { trackIds });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      toast('Adicionada à playlist');
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useRemoveTrack(id: string): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      await api.del(`/playlists/${id}/tracks`, { body: { entryIds: [entryId] } });
    },
    onMutate: async (entryId) => {
      await queryClient.cancelQueries({ queryKey: ['playlist', id] });
      const previous = queryClient.getQueryData<PlaylistWithTracksDto>(['playlist', id]);
      queryClient.setQueryData<PlaylistWithTracksDto>(['playlist', id], (old) =>
        old
          ? {
              ...old,
              trackCount: Math.max(0, old.trackCount - 1),
              tracks: old.tracks.filter((entry) => entry.entryId !== entryId),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _entryId, context) => {
      const ctx = context as { previous?: PlaylistWithTracksDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['playlist', id], ctx.previous);
      toast.error('Não foi possível remover a faixa.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['playlist', id] }),
  });
}

/** Optimistic reorder: moves the entry locally, then PATCHes the server. */
export function useReorderTrack(
  id: string,
): UseMutationResult<void, Error, ReorderPlaylistInput, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReorderPlaylistInput) => {
      await api.patch(`/playlists/${id}/tracks/reorder`, input);
    },
    onMutate: async ({ entryId, toPosition }) => {
      await queryClient.cancelQueries({ queryKey: ['playlist', id] });
      const previous = queryClient.getQueryData<PlaylistWithTracksDto>(['playlist', id]);
      queryClient.setQueryData<PlaylistWithTracksDto>(['playlist', id], (old) => {
        if (!old) return old;
        const from = old.tracks.findIndex((entry) => entry.entryId === entryId);
        if (from < 0) return old;
        const tracks = [...old.tracks];
        const [moved] = tracks.splice(from, 1);
        if (!moved) return old;
        tracks.splice(Math.min(toPosition, tracks.length), 0, moved);
        return {
          ...old,
          tracks: tracks.map((entry, position) => ({ ...entry, position })),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      const ctx = context as { previous?: PlaylistWithTracksDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['playlist', id], ctx.previous);
      toast.error('Não foi possível reordenar.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['playlist', id] }),
  });
}

export function useDeletePlaylist(id: string): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      await api.del(`/playlists/${id}`);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['playlist', id] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      toast('Playlist excluída');
      void navigate('/library');
    },
    onError: (error) => toast.error(error.message),
  });
}
