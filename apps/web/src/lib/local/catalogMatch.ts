/**
 * Identificação de faixa pelo CATÁLOGO do artista, não por busca solta.
 *
 * O acervo do usuário veio do YouTube em lotes por artista, e boa parte chegou
 * sem metadado nenhum — só o título em caixa alta. Buscar essas faixas uma a
 * uma pelo título é loteria: "CAROLINA" devolve o Ninho, "CEO" devolve o SCH,
 * "DIOR" devolve o Pop Smoke. Todas com capa bonita e todas erradas.
 *
 * A inversão que resolve: baixar o catálogo completo dos artistas que JÁ estão
 * na biblioteca e perguntar se a faixa órfã mora lá dentro. Medido contra o
 * acervo real do usuário — 52 de 55 faixas anônimas identificadas, contra 29
 * pela busca por título.
 *
 * A duração é o que torna isso seguro. Sem ela o casamento por título adotaria
 * qualquer xará; com ela, "ESTRESSE" só vira Alee se durar os mesmos 2:44.
 * Estas funções ATRIBUEM AUTORIA — errar aqui não deixa a faixa como estava,
 * deixa ela mentindo. Na dúvida, devolvem null.
 */
import type { TrackDto } from '@aurial/shared';
import { normalizeForMatch, titleSearchCandidates } from '@/lib/local/coverBackfill';

/** Uma faixa do catálogo do artista, como o importador entrega. */
export interface CatalogTrack {
  title: string;
  artist: string;
  album: string | null;
  /** Segundos (formato da Deezer). Sem isso não dá para conferir identidade. */
  duration: number | null;
  cover: string | null;
}

/**
 * Tolerância de duração. O mesmo master rippado do YouTube costuma bater no
 * segundo, mas silêncio de cabeça/cauda e o corte do encoder deslocam um pouco.
 * 4s aceita essa margem sem começar a aceitar outra música — versões diferentes
 * (ao vivo, remix, edit) erram por dezenas de segundos, não por três.
 */
export const DURATION_TOLERANCE_MS = 4_000;

/** Índice do catálogo por título normalizado — várias faixas podem dividir o
 *  mesmo título (regravação, versão de álbum vs single). */
export type CatalogIndex = Map<string, CatalogTrack[]>;

export function indexCatalog(tracks: readonly CatalogTrack[]): CatalogIndex {
  const index: CatalogIndex = new Map();
  for (const t of tracks) {
    if (!t?.title) continue;
    const key = normalizeForMatch(t.title);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(t);
    else index.set(key, [t]);
  }
  return index;
}

/**
 * Nomes de artista que valem baixar o catálogo, do mais representado ao menos.
 *
 * Sai da PRÓPRIA biblioteca de propósito. As faixas órfãs não caíram do céu:
 * vieram no mesmo lote que as identificadas, do mesmo álbum, do mesmo canal.
 * Quem já aparece creditado é, por construção, o palpite mais provável para
 * quem não aparece — e isso se adapta sozinho a qualquer acervo, sem lista
 * fixa de artistas escrita no código.
 */
export function candidateArtists(tracks: readonly TrackDto[]): string[] {
  const tally = new Map<string, { name: string; n: number }>();
  for (const track of tracks) {
    for (const a of track.artists ?? []) {
      const name = a?.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      const key = normalizeForMatch(name);
      if (!key) continue;
      const prev = tally.get(key);
      if (prev) prev.n += 1;
      else tally.set(key, { name, n: 1 });
    }
  }
  return [...tally.values()].sort((a, b) => b.n - a.n).map((v) => v.name);
}

/**
 * A faixa do catálogo que corresponde a esta — ou null.
 *
 * Exige título E duração. Quando o título casa em mais de um artista (existe
 * "SEGREDO" em vários catálogos), fica com o de duração mais próxima; se dois
 * artistas DIFERENTES empatam, desiste — não há como escolher sem chutar, e
 * chutar aqui grava autoria errada na biblioteca do usuário.
 */
export function matchInCatalog(track: TrackDto, index: CatalogIndex): CatalogTrack | null {
  const durMs = track.durationMs || 0;
  if (durMs <= 0) return null; // sem duração não há como conferir — não arrisca

  // "TUDO BEM FT. BNYX" no acervo é "TUDO BEM" no catálogo: tenta o título
  // limpo (sem participação/produtor/número de faixa) e o cru.
  const candidates = titleSearchCandidates(track.title);

  for (const raw of candidates) {
    const bucket = index.get(normalizeForMatch(raw));
    if (!bucket?.length) continue;

    const dentroDaMargem = bucket
      .filter((c) => typeof c.duration === 'number' && c.duration > 0)
      .map((c) => ({ c, delta: Math.abs((c.duration as number) * 1000 - durMs) }))
      .filter((x) => x.delta <= DURATION_TOLERANCE_MS)
      .sort((a, b) => a.delta - b.delta);

    if (!dentroDaMargem.length) continue;

    const [melhor, segundo] = dentroDaMargem;
    if (
      segundo &&
      segundo.delta === melhor.delta &&
      normalizeForMatch(segundo.c.artist) !== normalizeForMatch(melhor.c.artist)
    ) {
      continue; // empate entre artistas distintos: ambíguo demais
    }
    return melhor.c;
  }
  return null;
}
