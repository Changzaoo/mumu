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
    // O worker regrava a cada 30 min. A prateleira se atualiza sozinha: confere
    // de 2 em 2 minutos com a tela aberta e toda vez que o app volta à frente.
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => (await api.get<EmAltaDto | null>('/em-alta', { anonymous: true })).data,
  });
}
