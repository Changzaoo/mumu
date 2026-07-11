/**
 * Home feature — API hooks (GET /home).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { HomeDto } from '@aurial/shared';
import { api } from '@/lib/api';

export function useHome(): UseQueryResult<HomeDto> {
  return useQuery({
    queryKey: ['home'],
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<HomeDto>('/home')).data,
  });
}
