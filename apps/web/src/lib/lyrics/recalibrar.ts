/**
 * A LETRA NO RELÓGIO DO ÁUDIO — reancora cada verso onde a voz de fato está.
 *
 * O player segue a letra ao milissegundo, mas a letra publicada muitas vezes
 * foi cronometrada para OUTRA gravação. Medido em 2026-09-26 contra o áudio
 * real de "Bad and Boujee": a letra escolhida estava 520 a 1.200 ms adiantada,
 * e o erro CRESCIA ao longo da música — é a letra que "acaba antes da música".
 * Um deslocamento fixo não conserta deriva; cada verso precisa da própria
 * âncora.
 *
 * O importador calcula o instante de cada palavra cantada no arquivo do cofre
 * (`GET /blob/:id/tempo`). Aqui:
 *   - letra COM tempo: os versos reconhecidos no áudio vão para o tempo real; os
 *     demais herdam o deslocamento interpolado das âncoras vizinhas — assim a
 *     deriva é corrigida também onde o ASR não entendeu o verso;
 *   - letra SEM tempo: ganha o tempo do alinhamento direto;
 *   - SEM letra: vira letra a partir da própria transcrição, rotulada como tal.
 */
import type { Lyrics, LyricLine } from '@/lib/lyrics/lyrics';
import { alignLyrics, type AsrWord } from '@/lib/lyrics/align';

/** Âncora que destoa das vizinhas por mais que isto é casamento errado. */
const OUTLIER_MS = 2_500;

function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  return v.length === 0 ? 0 : (v[Math.floor(v.length / 2)] as number);
}

/**
 * Reancora a letra nas palavras do áudio. Devolve `null` quando o casamento é
 * fraco demais para confiar (letra de outra música, idioma trocado) — karaokê
 * fora de tempo é pior que o que já estava.
 */
export function recalibrarLetra(letra: Lyrics, palavras: AsrWord[]): Lyrics | null {
  if (letra.lines.length === 0 || palavras.length === 0) return null;
  const alinhadas = alignLyrics(
    letra.lines.map((l) => l.text),
    palavras,
  );
  if (!alinhadas) return null;

  if (!letra.synced) {
    return { ...letra, synced: true, lines: alinhadas.map(({ ancorada: _a, ...l }) => l) };
  }

  // Deslocamento (áudio − letra) em cada verso ancorado.
  const brutos: Array<{ i: number; d: number }> = [];
  alinhadas.forEach((a, i) => {
    const original = letra.lines[i];
    if (a.ancorada && original) brutos.push({ i, d: a.timeMs - original.timeMs });
  });
  if (brutos.length === 0) return null;
  // Casamento errado (o refrão casou com a repetição seguinte) aparece como uma
  // âncora que destoa muito das vizinhas: fora.
  const ancoras = brutos.filter(({ d }, k) => {
    const vizinhas = brutos.slice(Math.max(0, k - 4), k + 5).map((b) => b.d);
    return Math.abs(d - mediana(vizinhas)) <= OUTLIER_MS;
  });
  if (ancoras.length === 0) return null;

  const deslocamentoEm = (i: number): number => {
    let antes: { i: number; d: number } | undefined;
    let depois: { i: number; d: number } | undefined;
    for (const a of ancoras) {
      if (a.i <= i) antes = a;
      if (a.i >= i) {
        depois = a;
        break;
      }
    }
    if (antes && depois && depois.i !== antes.i) {
      const t = (i - antes.i) / (depois.i - antes.i);
      return antes.d + (depois.d - antes.d) * t;
    }
    return (antes ?? depois)!.d;
  };

  const ancoradas = new Set(ancoras.map((a) => a.i));
  let ultimo = 0;
  const lines: LyricLine[] = letra.lines.map((linha, i) => {
    const alinhada = alinhadas[i];
    const real = ancoradas.has(i) && alinhada;
    let timeMs = Math.max(0, Math.round(linha.timeMs + deslocamentoEm(i)));
    if (real) timeMs = alinhada.timeMs;
    timeMs = Math.max(timeMs, ultimo);
    ultimo = timeMs;
    const words = real && alinhada.words ? alinhada.words : undefined;
    return { timeMs, text: linha.text, ...(words ? { words } : {}) };
  });
  return { ...letra, lines };
}

/** Linhas a partir da transcrição pura (quando não existe letra publicada). */
export { palavrasEmLinhas } from '@/lib/lyrics/syncFromAudio';

/** URL do relógio da faixa, derivada da URL da cópia no cofre. */
export function urlDoTempo(remoteUrl: string, idioma: string): string | null {
  try {
    const u = new URL(remoteUrl);
    if (!/^\/blob\/[^/]+$/.test(u.pathname)) return null;
    u.pathname = `${u.pathname}/tempo`;
    u.searchParams.set('lang', idioma);
    return u.toString();
  } catch {
    return null;
  }
}

export type RespostaDoTempo =
  { tipo: 'pronto'; words: AsrWord[] } | { tipo: 'esperar' } | { tipo: 'desistir' };

/** Pergunta ao importador. Nunca lança. */
export async function buscarTempo(url: string): Promise<RespostaDoTempo> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 200) {
      const corpo = (await res.json()) as { words?: AsrWord[] };
      return corpo.words && corpo.words.length > 0
        ? { tipo: 'pronto', words: corpo.words }
        : { tipo: 'desistir' };
    }
    if (res.status === 202 || res.status === 503) return { tipo: 'esperar' };
    return { tipo: 'desistir' };
  } catch {
    return { tipo: 'esperar' };
  }
}
