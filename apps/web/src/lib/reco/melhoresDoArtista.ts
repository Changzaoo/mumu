/**
 * AS MELHORES DO ARTISTA — o "This is <artista>" do app.
 *
 * A pergunta é "quais são as músicas DESTE artista que valem tocar primeiro",
 * e a resposta só pode sair do que existe no acervo: tocar é tocar o que se
 * tem. Por isso a entrada é a lista de faixas do artista na biblioteca
 * (`localLibrary.artistTracks`) e a saída é essa mesma lista, reordenada e
 * sem repetição — nunca uma faixa que o app não saiba tocar.
 *
 * A ORDEM, do sinal mais forte ao mais fraco:
 *
 *   1. POPULARIDADE MUNDIAL (lib/artistTop — o top do artista no catálogo).
 *      É o que o "This is" do Spotify faz: quem aperta play num artista quer
 *      os hits dele primeiro, não a ordem em que os arquivos chegaram.
 *   2. O QUE A PESSOA OUVE DELE, com a régua de sempre (`pesoDoPlay`: recência
 *      × quanto foi ouvido) e a curtida como bônus. Desempata os hits e ordena
 *      o que o catálogo não conhece — o lado B que ela vive tocando.
 *   3. A ORDEM DO ACERVO, quando não há sinal nenhum.
 *
 * SEM REPETIÇÃO. O mesmo hit costuma estar duas vezes no acervo (o single e a
 * faixa do álbum, o "Ao Vivo" importado por link). A fila não pode tocar a
 * mesma música duas vezes seguidas: fica a versão melhor posicionada.
 *
 * Pura: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { normTitle, rankingDe } from '@/lib/artistTop';
import { PESO_CURTIDA, pesoDoPlay, type PlayObservado } from './perfilDeGosto';

/** Tamanho da fila — o "This is" é uma seleção, não a discografia inteira. */
export const LIMITE_MELHORES = 50;

export interface SinaisDoArtista {
  /** Títulos do top mundial, do mais ao menos popular. */
  rankingMundial?: readonly string[];
  historico?: readonly PlayObservado[];
  curtidas?: readonly TrackDto[];
  now?: Date;
  limite?: number;
}

interface Candidata {
  track: TrackDto;
  indice: number;
  rank: number;
  peso: number;
}

/** `a` vem antes de `b`? Ranking → peso pessoal → ordem do acervo. */
function comparar(a: Candidata, b: Candidata): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.peso !== b.peso) return b.peso - a.peso;
  return a.indice - b.indice;
}

export function melhoresDoArtista(
  faixas: readonly TrackDto[],
  sinais: SinaisDoArtista = {},
): TrackDto[] {
  const agora = (sinais.now ?? new Date()).getTime();
  const limite = sinais.limite ?? LIMITE_MELHORES;
  const rankDe = rankingDe(sinais.rankingMundial ?? []);

  const peso = new Map<string, number>();
  for (const play of sinais.historico ?? []) {
    const id = play.track?.id;
    if (id) peso.set(id, (peso.get(id) ?? 0) + pesoDoPlay(play, agora));
  }
  for (const t of sinais.curtidas ?? []) {
    peso.set(t.id, (peso.get(t.id) ?? 0) + PESO_CURTIDA);
  }

  // Uma candidata por MÚSICA (título normalizado), a melhor versão vence.
  const porMusica = new Map<string, Candidata>();
  faixas.forEach((track, indice) => {
    // Prévia de 30s não é música de verdade — não entra em fila de "melhores".
    if (track.previewOnly) return;
    const candidata: Candidata = {
      track,
      indice,
      rank: rankDe(track),
      peso: peso.get(track.id) ?? 0,
    };
    const chave = normTitle(track.title) || `id:${track.id}`;
    const atual = porMusica.get(chave);
    if (!atual) {
      porMusica.set(chave, candidata);
      return;
    }
    // A versão que fica herda o sinal das duas: plays divididos entre o single
    // e a faixa do álbum são plays DA MESMA música.
    const vence = comparar(candidata, atual) < 0 ? candidata : atual;
    porMusica.set(chave, {
      ...vence,
      rank: Math.min(atual.rank, candidata.rank),
      peso: atual.peso + candidata.peso,
      indice: Math.min(atual.indice, candidata.indice),
    });
  });

  return [...porMusica.values()]
    .sort(comparar)
    .slice(0, Math.max(0, limite))
    .map((c) => c.track);
}
