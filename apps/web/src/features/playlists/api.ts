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
} from '@radinho/shared';
import { api } from '@/lib/api';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { entryFor } from '@/lib/local/localLibrary';

/**
 * A LISTA MOSTRA A DURAÇÃO QUE A BIBLIOTECA SABE HOJE.
 *
 * A playlist do aparelho guarda uma FOTO de cada faixa, tirada quando ela foi
 * adicionada — e muitas foram adicionadas logo depois de importar, com o
 * `durationMs: 0` de então. Quando a duração é medida depois (ao tocar, ou pela
 * varredura do servidor), ela chega à biblioteca, não à foto: a lista ficava
 * em "0:00" para sempre. A biblioteca é quem recebe as correções; aqui ela
 * vence a foto.
 */
function comDuracoesDaBiblioteca(dto: PlaylistWithTracksDto): PlaylistWithTracksDto {
  let mudou = false;
  const tracks = dto.tracks.map((e) => {
    const atual = entryFor(e.track.id)?.track.durationMs;
    if (!(typeof atual === 'number' && Number.isFinite(atual) && atual > 0)) return e;
    if (atual === e.track.durationMs) return e;
    mudou = true;
    return { ...e, track: { ...e.track, durationMs: atual } };
  });
  if (!mudou) return dto;
  const durationMs = tracks.reduce((soma, e) => soma + (e.track.durationMs || 0), 0);
  return { ...dto, durationMs, tracks };
}

export function usePlaylist(id: string): UseQueryResult<PlaylistWithTracksDto> {
  return useQuery({
    queryKey: ['playlist', id],
    // Local playlists render straight from on-device storage — no network.
    ...(localPlaylists.isLocalPlaylistId(id) ? { staleTime: 0 } : {}),
    queryFn: async () => {
      if (localPlaylists.isLocalPlaylistId(id)) {
        const playlist = localPlaylists.get(id);
        if (!playlist) throw new Error('Playlist não encontrada.');
        return comDuracoesDaBiblioteca(localPlaylists.toPlaylistWithTracksDto(playlist));
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
