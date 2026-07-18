/**
 * Ordem de POPULARIDADE MUNDIAL das faixas de um artista.
 *
 * A página do artista abria com álbuns e depois as faixas na ordem em que
 * entraram no acervo — ordem de importação não diz nada sobre a música. Aqui o
 * ranking vem do mundo real (Deezer, via o importer), não do histórico do
 * usuário: quem chega numa página de artista quer ver os hits dele primeiro.
 *
 * O ranking só REORDENA o que o usuário já tem; faixa que não aparece no top
 * do catálogo vai para o fim, nunca some. Sem rede, a ordem local é devolvida
 * intacta — a seção degrada, não quebra.
 */
import { useSyncExternalStore } from 'react';
import type { TrackDto } from '@aurial/shared';
import { fetchArtistTop } from '@/lib/local/importerHelper';

const CACHE_KEY = 'aurial:artist-top';
// Popularidade muda devagar; uma semana evita refetch a cada visita e ainda
// deixa a lista respirar com o tempo.
const TTL_MS = 7 * 24 * 60 * 60_000;

interface CachedTop {
  /** Títulos em ordem de popularidade (o que basta para ordenar). */
  titles: string[];
  fans: number | null;
  at: number;
}

type Cache = Record<string, CachedTop>;

let cache: Cache | null = null;
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function read(): Cache {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Cache): void {
  cache = next;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  emit();
}

const normKey = (name: string): string => name.trim().toLowerCase();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Normaliza um título para casar acervo × catálogo. O mesmo hit vem gravado de
 * jeitos diferentes ("Song (feat. X)", "Song - Remastered 2011"), então tudo
 * que é sufixo editorial cai fora antes da comparação.
 */
export function normTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((feat|ft|with|part|pt)\.?[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s-\s.*(remaster|remix|version|edit|ao vivo|live|acoustic|radio).*$/i, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Reordena as faixas locais pelo ranking de popularidade (`rankedTitles`, já em
 * ordem decrescente). Faixas fora do ranking mantêm a ordem original logo
 * depois das ranqueadas. Função pura — testada em `__tests__/artistTop.test.ts`.
 */
export function rankTracks(tracks: TrackDto[], rankedTitles: string[]): TrackDto[] {
  if (rankedTitles.length === 0) return tracks;

  const position = new Map<string, number>();
  rankedTitles.forEach((title, i) => {
    const key = normTitle(title);
    // Primeira ocorrência vence: o catálogo já vem do mais popular ao menos.
    if (key && !position.has(key)) position.set(key, i);
  });

  const rankOf = (track: TrackDto): number => {
    const key = normTitle(track.title);
    if (!key) return Infinity;
    const exact = position.get(key);
    if (exact !== undefined) return exact;
    // Casamento frouxo: sobra de edição em um dos lados ("Song" × "Song Ao Vivo").
    for (const [candidate, i] of position) {
      if (candidate.startsWith(key) || key.startsWith(candidate)) return i;
    }
    return Infinity;
  };

  return tracks
    .map((track, index) => ({ track, index, rank: rankOf(track) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((row) => row.track);
}

interface ArtistTopState {
  titles: string[];
  fans: number | null;
}

const EMPTY_STATE: ArtistTopState = { titles: [], fans: null };

function lookup(name: string): ArtistTopState {
  const key = normKey(name);
  if (!key) return EMPTY_STATE;
  const map = read();
  const hit = map[key];
  if (hit && Date.now() - hit.at < TTL_MS) return { titles: hit.titles, fans: hit.fans };
  if (!inflight.has(key)) {
    inflight.add(key);
    void fetchArtistTop(name)
      .then((top) => {
        // Sem resultado não vira cache vazio permanente — só não reordena agora.
        if (!top) return;
        write({
          ...read(),
          [key]: { titles: top.tracks.map((t) => t.title), fans: top.fans, at: Date.now() },
        });
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
  }
  return hit ? { titles: hit.titles, fans: hit.fans } : EMPTY_STATE;
}

/**
 * Hook: as faixas do artista em ordem de popularidade mundial. Enquanto o
 * ranking não chega (ou nunca chega), devolve a ordem recebida.
 */
export function useArtistTopTracks(
  name: string,
  tracks: TrackDto[],
): { tracks: TrackDto[]; ranked: boolean; fans: number | null } {
  useSyncExternalStore(subscribe, () => read()[normKey(name)]?.at ?? 0);
  const { titles, fans } = lookup(name);
  return { tracks: rankTracks(tracks, titles), ranked: titles.length > 0, fans };
}
