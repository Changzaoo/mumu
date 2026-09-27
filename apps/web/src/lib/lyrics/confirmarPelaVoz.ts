/**
 * A LETRA CONFIRMADA PELA VOZ — antes de mostrar uma transcrição, procurar a
 * letra de verdade e provar que é desta música com o próprio áudio.
 *
 * A transcrição automática erra com autotune e sotaque ("a vida mudou a ful",
 * "pela sol"), e já filtrada fica com buracos. Mas mesmo errando ela acerta a
 * MAIORIA das palavras — e isso basta para reconhecer a letra certa entre as
 * candidatas com o mesmo título, que o casamento estrito por artista/duração
 * descartou (o LRCLIB tem "Lembrei de Tu" como "Men0", e as versões com o nome
 * certo têm outra duração).
 *
 * A PROVA é a cobertura: das palavras distintas que o modelo ouviu COM
 * CONFIANÇA, quantas aparecem na letra candidata. Medido com a faixa real:
 *   • a letra certa (várias versões):            59–64%
 *   • músicas erradas do mesmo artista e gênero: 14–30%
 *   • um show de 9 min que contém a música:      39%
 * O corte em 50% separa os dois grupos com folga dos dois lados, e só vale
 * junto com o título igual (a busca já vem filtrada por ele).
 *
 * A letra aceita não é mostrada com o relógio de outra gravação: ela segue
 * para o ALINHAMENTO com o áudio (palavra por palavra). Versão de duração
 * diferente vai sem o tempo dela — se o alinhamento falhar, fica o texto certo
 * sem sincronia, e não a sincronia de outra gravação.
 */
import type { TrackDto } from '@radinho/shared';
import { letrasComOMesmoTitulo, toLyrics, type LrclibRow, type Lyrics } from '@/lib/lyrics/lyrics';

/** Cobertura mínima para aceitar uma candidata (ver as medições acima). */
export const COBERTURA_MINIMA = 0.5;
/** Confiança mínima da palavra ouvida para contar como prova. */
const CONFIANCA = 0.6;
/** Com menos que isso ouvido, não há prova suficiente para nada. */
export const PALAVRAS_MINIMAS = 20;
/** Diferença de duração que ainda é "a mesma gravação" (o relógio serve). */
const MESMA_GRAVACAO_SEG = 4;

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function tokens(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ') // marcas de tempo do LRC
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** Palavras distintas ouvidas com confiança — a prova. */
export function palavrasOuvidas(words: readonly { text: string; prob?: number }[]): string[] {
  return [
    ...new Set(words.filter((w) => (w.prob ?? 1) >= CONFIANCA).flatMap((w) => tokens(w.text))),
  ];
}

/** Fração das palavras ouvidas que a letra contém. */
export function coberturaDaVoz(ouvidas: readonly string[], letra: string): number {
  if (ouvidas.length === 0) return 0;
  const daLetra = new Set(tokens(letra));
  return ouvidas.filter((t) => daLetra.has(t)).length / ouvidas.length;
}

function textoDa(row: LrclibRow): string {
  return row.plainLyrics?.trim() || row.syncedLyrics?.trim() || '';
}

/**
 * Entre as candidatas, a que a voz confirma — ou null. Puro (testável): quem
 * busca as candidatas é `letraConfirmadaPelaVoz`.
 *
 * Várias passando (a mesma música em versões diferentes): fica a de duração
 * mais próxima; empate, a de maior cobertura.
 */
export function escolherPelaVoz(
  candidatas: readonly LrclibRow[],
  words: readonly { text: string; prob?: number }[],
  duracaoSeg: number,
): Lyrics | null {
  const ouvidas = palavrasOuvidas(words);
  if (ouvidas.length < PALAVRAS_MINIMAS) return null;
  let melhor: { row: LrclibRow; cobertura: number; diferenca: number } | null = null;
  for (const row of candidatas) {
    if (row.instrumental) continue;
    const texto = textoDa(row);
    if (!texto) continue;
    const cobertura = coberturaDaVoz(ouvidas, texto);
    if (cobertura < COBERTURA_MINIMA) continue;
    const diferenca =
      duracaoSeg > 0 && typeof row.duration === 'number'
        ? Math.abs(row.duration - duracaoSeg)
        : Number.POSITIVE_INFINITY;
    if (
      !melhor ||
      diferenca < melhor.diferenca ||
      (diferenca === melhor.diferenca && cobertura > melhor.cobertura)
    ) {
      melhor = { row, cobertura, diferenca };
    }
  }
  if (!melhor) return null;
  const letra = toLyrics(melhor.row);
  if (!letra) return null;
  // Outra gravação: o texto serve, o relógio não.
  if (letra.synced && !(melhor.diferenca <= MESMA_GRAVACAO_SEG)) {
    return { ...letra, synced: false, lines: letra.lines.map((l) => ({ ...l, timeMs: 0 })) };
  }
  return letra;
}

/** Busca as candidatas pelo título e deixa a voz escolher. Nunca lança. */
export async function letraConfirmadaPelaVoz(
  track: TrackDto,
  words: readonly { text: string; prob?: number }[],
): Promise<Lyrics | null> {
  if (palavrasOuvidas(words).length < PALAVRAS_MINIMAS) return null;
  try {
    const candidatas = await letrasComOMesmoTitulo(track);
    return escolherPelaVoz(candidatas, words, Math.round((track.durationMs || 0) / 1000));
  } catch {
    return null;
  }
}
