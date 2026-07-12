/**
 * Community trending feed — reads the global likes-fed "em alta" from Firestore.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { TrackDto } from '@aurial/shared';
import { APPLE_GENRES } from '@/lib/catalog/itunes';
import { topByGenre, topTrending } from '@/lib/trending/trending';

/** Overall community top when no genre is selected, else top for that genre. */
export function useCommunityTrending(genreId: number | null): UseQueryResult<TrackDto[]> {
  const label =
    genreId === null ? null : (APPLE_GENRES.find((g) => g.id === genreId)?.label ?? null);
  return useQuery({
    queryKey: ['community-trending', genreId],
    staleTime: 60_000,
    queryFn: () => (label ? topByGenre(label) : topTrending()),
  });
}
