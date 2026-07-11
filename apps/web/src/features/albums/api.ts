/**
 * Albums feature — detail hook (GET /albums/:id includes tracks).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AlbumWithTracksDto } from '@aurial/shared';
import { api } from '@/lib/api';

/** AlbumWithTracksDto + optional server-side "is in my library" flag. */
export interface AlbumDetailDto extends AlbumWithTracksDto {
  isLiked?: boolean;
}

export function useAlbum(id: string): UseQueryResult<AlbumDetailDto> {
  return useQuery({
    queryKey: ['album', id],
    queryFn: async () => (await api.get<AlbumDetailDto>(`/albums/${id}`)).data,
  });
}
