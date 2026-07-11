/**
 * Artists feature — detail hooks + optimistic follow.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AlbumDto, ArtistDto, TrackDto } from '@aurial/shared';
import { api } from '@/lib/api';

/** ArtistDto + optional server-side "am I following" flag. */
export interface ArtistDetailDto extends ArtistDto {
  isFollowing?: boolean;
}

export function useArtist(id: string): UseQueryResult<ArtistDetailDto> {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: async () => (await api.get<ArtistDetailDto>(`/artists/${id}`)).data,
  });
}

export function useArtistTopTracks(id: string): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['artist', id, 'top-tracks'],
    queryFn: async () => (await api.get<TrackDto[]>(`/artists/${id}/top-tracks`)).data,
  });
}

export function useArtistAlbums(id: string): UseQueryResult<AlbumDto[]> {
  return useQuery({
    queryKey: ['artist', id, 'albums'],
    queryFn: async () => (await api.get<AlbumDto[]>(`/artists/${id}/albums`)).data,
  });
}

export function useRelatedArtists(id: string): UseQueryResult<ArtistDto[]> {
  return useQuery({
    queryKey: ['artist', id, 'related'],
    queryFn: async () => (await api.get<ArtistDto[]>(`/artists/${id}/related`)).data,
  });
}

/** Optimistic follow/unfollow (POST/DELETE /artists/:id/follow). */
export function useFollowArtist(id: string): UseMutationResult<void, Error, boolean, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (follow: boolean) => {
      if (follow) await api.post(`/artists/${id}/follow`);
      else await api.del(`/artists/${id}/follow`);
    },
    onMutate: async (follow) => {
      await queryClient.cancelQueries({ queryKey: ['artist', id] });
      const previous = queryClient.getQueryData<ArtistDetailDto>(['artist', id]);
      queryClient.setQueryData<ArtistDetailDto>(['artist', id], (old) =>
        old
          ? {
              ...old,
              isFollowing: follow,
              followersCount: Math.max(0, old.followersCount + (follow ? 1 : -1)),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _follow, context) => {
      const ctx = context as { previous?: ArtistDetailDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['artist', id], ctx.previous);
      toast.error('Não foi possível atualizar o seguir.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['artist', id] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
}
