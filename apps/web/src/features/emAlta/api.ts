/**
 * "Em alta" por gênero — lê o retrato que o worker de paradas gravou no
 * servidor (`GET /em-alta`). A página nunca consulta parada nenhuma: o que
 * chega aqui já veio fundido, com gênero e veredito de conteúdo.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { EmAltaDto } from '@radinho/shared';
import { api } from '@/lib/api';

export function useEmAlta(): UseQueryResult<EmAltaDto | null> {
  return useQuery({
    queryKey: ['em-alta'],
    // O worker regrava a cada ~3 h; dez minutos de cache não deixam nada velho.
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => (await api.get<EmAltaDto | null>('/em-alta', { anonymous: true })).data,
  });
}
