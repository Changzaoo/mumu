/**
 * O QUE VEM DEPOIS QUE A LISTA ACABA — e em que ordem.
 *
 * "No final de uma playlist, tente linkar outra playlist para que o usuário
 * nunca pare de escutar." Duas peças, as duas puras:
 *
 *  1. `escolherProximaPlaylist`: das playlists DA PESSOA, a que mais se parece
 *     com a que acabou — pelos artistas em comum, depois pelos gêneros. Uma
 *     sem nada em comum não serve: pular de funk para louvor no meio da noite
 *     é interromper, não continuar. Sem candidata parecida, quem assume é a
 *     rádio de parecidas, que já existia.
 *
 *  2. `reordenarPeloGosto`: a ordem do que vai tocar. Parte da ordem que veio
 *     (a da playlist, ou a da rádio) e ajusta dois sinais: o que a pessoa
 *     PULOU há pouco desce (ver `pulos.ts` — desce, não sai), e o que é dos
 *     artistas que ela MAIS ouve sobe. A ordem original ainda pesa: a
 *     reordenação empurra, não embaralha.
 */
import type { TrackDto } from '@radinho/shared';
import { artistIdentityKey } from '@/lib/local/artistIdentity';

export interface PlaylistCandidata {
  id: string;
  title: string;
  faixas: readonly TrackDto[];
}

const artistas = (faixas: readonly TrackDto[]): Set<string> =>
  new Set(faixas.map((t) => artistIdentityKey(t.artists[0]?.name ?? '')).filter(Boolean));

const generos = (faixas: readonly TrackDto[]): Set<string> =>
  new Set(faixas.map((t) => (t.genre ?? '').toLowerCase().trim()).filter(Boolean));

/** Jaccard: quanto dos dois conjuntos é comum. 0 quando algum está vazio. */
function semelhanca(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum++;
  return comum / (a.size + b.size - comum);
}

/**
 * A próxima playlist, ou `null` quando nenhuma tem a ver.
 *
 * `evitar`: playlists já emendadas nesta sessão — sem isso, duas playlists
 * parecidas virariam um pingue-pongue A → B → A → B a noite inteira.
 */
export function escolherProximaPlaylist(
  atual: PlaylistCandidata,
  candidatas: readonly PlaylistCandidata[],
  evitar: ReadonlySet<string> = new Set(),
): PlaylistCandidata | null {
  const artistasDaAtual = artistas(atual.faixas);
  const generosDaAtual = generos(atual.faixas);
  let melhor: PlaylistCandidata | null = null;
  let melhorNota = 0;
  for (const c of candidatas) {
    if (c.id === atual.id || evitar.has(c.id)) continue;
    // Uma faixa só não é playlist para emendar — é quase um single.
    if (c.faixas.length < 2) continue;
    const nota =
      0.7 * semelhanca(artistasDaAtual, artistas(c.faixas)) +
      0.3 * semelhanca(generosDaAtual, generos(c.faixas));
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = c;
    }
  }
  return melhor;
}

export interface SinaisDeGosto {
  /** Multiplicador do pulo (ver `fatorDePulo`), em [0.3, 1]. */
  fatorDePulo: (track: TrackDto) => number;
  /** Afinidade com o artista da faixa, em [0, 1] (1 = o mais ouvido). */
  afinidade?: (track: TrackDto) => number;
}

/** Quanto a posição original ainda manda: 0,6 = o último perde 60% do peso. */
const PESO_DA_ORDEM = 0.6;
/** Quanto o artista favorito sobe: até +50% no topo da afinidade. */
const BONUS_DE_GOSTO = 0.5;

export function reordenarPeloGosto(faixas: readonly TrackDto[], sinais: SinaisDeGosto): TrackDto[] {
  const n = faixas.length;
  if (n <= 1) return [...faixas];
  const notas = faixas.map((t, i) => {
    const ordem = 1 - PESO_DA_ORDEM * (i / (n - 1));
    const gosto = 1 + BONUS_DE_GOSTO * (sinais.afinidade?.(t) ?? 0);
    return { t, i, nota: ordem * sinais.fatorDePulo(t) * gosto };
  });
  // Estável: empate fica na ordem que veio.
  notas.sort((a, b) => b.nota - a.nota || a.i - b.i);
  return notas.map((x) => x.t);
}
