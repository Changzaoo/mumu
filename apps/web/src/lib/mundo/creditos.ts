/**
 * CRÉDITOS PROFUNDOS no app — quem produziu, compôs, mixou, lançou.
 *
 * O servidor (`/mundo/faixa/:id/creditos`) é a fonte: o worker `creditos` já
 * leu MusicBrainz, Discogs e o que o importador trouxe, fundiu pela regra
 * única de nomes e gravou por papel. Enquanto o worker não chega numa faixa
 * (`identificada === null`), vale a busca antiga no navegador
 * (lib/credits, MusicBrainz direto) — melhor que esconder o crédito.
 *
 * Cada nome creditado tem uma CHAVE de identidade (a mesma do acervo): é o
 * que liga o produtor à página dele (`/pessoa/:chave`) e, quando ele também é
 * artista do acervo, à ficha de artista — sem duplicar ninguém.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { TrackDto } from '@radinho/shared';
import { chaveDeIdentidadeDoArtista } from '@radinho/shared';
import { api } from '@/lib/api';
import { fetchCredits, type Credits } from '@/lib/credits/credits';
import * as localLibrary from '@/lib/local/localLibrary';

export type PapelDeCredito =
  | 'PRODUTOR'
  | 'COMPOSITOR'
  | 'LETRISTA'
  | 'ARRANJADOR'
  | 'MIXAGEM'
  | 'MASTERIZACAO'
  | 'ENGENHEIRO'
  | 'INTERPRETE'
  | 'GRAVADORA'
  | 'SELO'
  | 'PRODUTORA'
  | 'EDITORA'
  | 'EMPRESARIO';

export interface Credito {
  papel: PapelDeCredito;
  nome: string;
  chave: string;
  fonte: string;
  dados: Record<string, unknown> | null;
}

export interface CreditosDaFaixa {
  trackId: string;
  lidoEm: string | null;
  identificada: boolean | null;
  creditos: Credito[];
}

export interface Colaborador {
  papel: PapelDeCredito;
  nome: string;
  chave: string;
  faixas: number;
}

export interface FichaTecnica {
  artista: string;
  lidoEm: string | null;
  doArtista: Credito[];
  colaboradores: Colaborador[];
  faixasLidas: number;
  faixasNoAcervo: number;
}

export interface FaixaCreditada {
  trackId: string;
  titulo: string;
  artista: string;
  coverUrl: string | null;
  papeis: PapelDeCredito[];
}

export interface Pessoa {
  chave: string;
  nome: string;
  papeis: Array<{ papel: PapelDeCredito; faixas: number }>;
  faixas: FaixaCreditada[];
  artistas: Array<{ artista: string; papel: PapelDeCredito }>;
}

const STALE = 10 * 60_000;

/** O rótulo de cada papel, como a tela mostra. */
export const ROTULO_DO_PAPEL: Record<PapelDeCredito, string> = {
  PRODUTOR: 'Produção',
  COMPOSITOR: 'Composição',
  LETRISTA: 'Letra',
  ARRANJADOR: 'Arranjo',
  MIXAGEM: 'Mixagem',
  MASTERIZACAO: 'Masterização',
  ENGENHEIRO: 'Engenharia',
  INTERPRETE: 'Participação',
  GRAVADORA: 'Gravadora',
  SELO: 'Selo',
  PRODUTORA: 'Produtora',
  EDITORA: 'Editora',
  EMPRESARIO: 'Empresário',
};

/** Papéis de PESSOA (navegam para /pessoa); os outros são empresas. */
export const PAPEIS_DE_PESSOA: ReadonlySet<PapelDeCredito> = new Set([
  'PRODUTOR',
  'COMPOSITOR',
  'LETRISTA',
  'ARRANJADOR',
  'MIXAGEM',
  'MASTERIZACAO',
  'ENGENHEIRO',
  'INTERPRETE',
]);

/** Para onde um nome creditado leva. Puro. */
export function destinoDoCredito(c: Pick<Credito, 'papel' | 'nome' | 'chave'>): string {
  if (c.papel === 'GRAVADORA' || c.papel === 'SELO')
    return `/gravadora/${encodeURIComponent(c.nome)}`;
  // Pessoa que também é artista do acervo vai para a ficha de artista — a
  // mesma pessoa, uma página só.
  const noAcervo = PAPEIS_DE_PESSOA.has(c.papel) ? artistaDoAcervoPorChave(c.chave) : null;
  if (noAcervo) return `/artista/${encodeURIComponent(noAcervo)}`;
  return `/pessoa/${encodeURIComponent(c.chave)}`;
}

/** O nome do artista do acervo com esta chave de identidade, se houver. */
export function artistaDoAcervoPorChave(chave: string): string | null {
  if (!chave) return null;
  for (const entrada of localLibrary.list()) {
    for (const a of entrada.track.artists) {
      if (a.name && chaveDeIdentidadeDoArtista(a.name) === chave) return a.name;
    }
  }
  return null;
}

/** Os créditos vindos do navegador (lib/credits) no formato do servidor. Puro. */
export function creditosDoNavegador(c: Credits, primeiroArtista: string | undefined): Credito[] {
  const saida: Credito[] = [];
  const por = (papel: PapelDeCredito, nomes: string[]): void => {
    for (const nome of nomes) {
      if (!nome || nome === primeiroArtista) continue;
      const chave = chaveDeIdentidadeDoArtista(nome);
      if (chave) saida.push({ papel, nome, chave, fonte: 'navegador', dados: null });
    }
  };
  por('PRODUTOR', c.producers);
  por('COMPOSITOR', c.composers);
  por('LETRISTA', c.lyricists);
  por('INTERPRETE', c.performers);
  return saida;
}

/** Agrupa por papel, na ordem da tela. Puro. */
export function porPapel(creditos: Credito[]): Array<{ papel: PapelDeCredito; nomes: Credito[] }> {
  const ordem = Object.keys(ROTULO_DO_PAPEL) as PapelDeCredito[];
  const grupos = new Map<PapelDeCredito, Credito[]>();
  for (const c of creditos) grupos.set(c.papel, [...(grupos.get(c.papel) ?? []), c]);
  return ordem.filter((p) => grupos.has(p)).map((p) => ({ papel: p, nomes: grupos.get(p) ?? [] }));
}

async function buscarCreditosDaFaixa(track: TrackDto): Promise<CreditosDaFaixa> {
  let doServidor: CreditosDaFaixa | null = null;
  try {
    const r = await api.get<CreditosDaFaixa>(
      `/mundo/faixa/${encodeURIComponent(track.id)}/creditos`,
      {
        anonymous: true,
      },
    );
    doServidor = r.data;
  } catch {
    doServidor = null;
  }
  if (doServidor && doServidor.identificada !== null) return doServidor;
  // O worker ainda não chegou nesta faixa: a busca antiga no navegador quebra
  // o galho (e o que o arquivo trouxe na tag também conta).
  const creditos: Credito[] = [];
  if (track.composer) {
    for (const nome of track.composer.split(/\s*[,;/&]\s*|\s+e\s+/)) {
      const chave = chaveDeIdentidadeDoArtista(nome);
      if (nome.trim() && chave)
        creditos.push({
          papel: 'COMPOSITOR',
          nome: nome.trim(),
          chave,
          fonte: 'acervo',
          dados: null,
        });
    }
  }
  const navegador = await fetchCredits(track).catch(() => null);
  if (navegador) creditos.push(...creditosDoNavegador(navegador, track.artists[0]?.name));
  return { trackId: track.id, lidoEm: null, identificada: null, creditos };
}

export function useCreditosDaFaixa(
  track: TrackDto | null | undefined,
  ligado = true,
): UseQueryResult<CreditosDaFaixa> {
  return useQuery({
    queryKey: ['mundo', 'creditos', track?.id],
    enabled: ligado && Boolean(track),
    staleTime: STALE,
    retry: false,
    queryFn: () => buscarCreditosDaFaixa(track as TrackDto),
  });
}

export function useFichaTecnica(nome: string, ligado = true): UseQueryResult<FichaTecnica | null> {
  return useQuery({
    queryKey: ['mundo', 'ficha-tecnica', nome],
    enabled: ligado && nome.trim().length > 0,
    staleTime: STALE,
    retry: false,
    queryFn: async () => {
      try {
        const r = await api.get<FichaTecnica>(
          `/mundo/artista/${encodeURIComponent(nome)}/creditos`,
          {
            anonymous: true,
          },
        );
        return r.data;
      } catch {
        return null;
      }
    },
  });
}

export function usePessoa(chave: string): UseQueryResult<Pessoa | null> {
  return useQuery({
    queryKey: ['mundo', 'pessoa', chave],
    enabled: chave.trim().length > 0,
    staleTime: STALE,
    retry: false,
    queryFn: async () => {
      try {
        const r = await api.get<Pessoa>(`/mundo/pessoa/${encodeURIComponent(chave)}`, {
          anonymous: true,
        });
        return r.data;
      } catch {
        return null;
      }
    },
  });
}
