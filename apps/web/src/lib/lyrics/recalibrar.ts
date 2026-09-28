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

/** O que a transcrição já ouviu enquanto ainda trabalha (ver palavras.py). */
export interface TranscricaoParcial {
  words: Array<AsrWord & { prob?: number }>;
  /** Até onde da música o modelo já ouviu. */
  ouvidoMs: number;
}

export type RespostaDoTempo =
  | { tipo: 'pronto'; words: AsrWord[] }
  | { tipo: 'esperar'; processando?: boolean; parcial?: TranscricaoParcial }
  | { tipo: 'desistir' };

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
    if (res.status === 202) {
      const corpo = (await res.json().catch(() => ({}))) as {
        status?: string;
        parcial?: TranscricaoParcial;
      };
      return {
        tipo: 'esperar',
        processando: corpo.status === 'processando',
        ...(corpo.parcial ? { parcial: corpo.parcial } : {}),
      };
    }
    if (res.status === 503) return { tipo: 'esperar' };
    return { tipo: 'desistir' };
  } catch {
    return { tipo: 'esperar' };
  }
}

// ── ALINHAMENTO FORÇADO: o texto da letra publicada, o relógio do áudio ─────
//
// O caminho principal. O reconhecimento livre (acima) precisa ENTENDER o que é
// cantado, e com sotaque, autotune e batida pesada ele erra: para "Mantém"
// (Matuê) devolveu "proprietary Passe Passe…", nada casou com a letra e ela
// ficou com o tempo errado do LRCLIB — começando ~11,6 s antes da voz. No
// alinhamento o importador recebe o TEXTO e só procura onde ele é cantado.

/** Palavra alinhada: o texto veio da letra, o tempo do áudio. */
export interface PalavraAlinhada {
  text: string;
  startMs: number;
  endMs: number;
  prob: number;
}

export interface LinhaAlinhada {
  startMs: number;
  endMs: number;
  words: PalavraAlinhada[];
}

/** Linha que NÃO é cantada: cabeçalho de seção ("[Refrão: Mano Brown]"). */
function ehCabecalho(texto: string): boolean {
  return /^\s*\[[^\]]*\]\s*$/.test(texto);
}

/** Quais linhas da letra vão para o alinhamento (índices, na ordem). */
export function linhasParaAlinhar(letra: Lyrics): number[] {
  const indices: number[] = [];
  letra.lines.forEach((l, i) => {
    if (l.text.trim() && !ehCabecalho(l.text)) indices.push(i);
  });
  return indices;
}

/** Confiança de uma linha alinhada: média das palavras. */
function confianca(l: LinhaAlinhada | undefined): number {
  if (!l || l.words.length === 0) return 0;
  return l.words.reduce((s, w) => s + w.prob, 0) / l.words.length;
}

/** Abaixo disto a linha não serve de âncora — o modelo mal a encontrou. */
const LINHA_CONFIAVEL = 0.3;

/**
 * Aplica o alinhamento à letra. Nunca troca o texto.
 *
 * Letra COM tempo: cada linha bem alinhada é uma âncora (tempo real); as outras
 * herdam o deslocamento interpolado das âncoras vizinhas. Âncora que destoa
 * muito das vizinhas (o refrão encaixado na repetição errada, a introdução
 * confusa) é descartada — é o que protege contra UM verso mal alinhado.
 *
 * Letra SEM tempo: as linhas confiáveis ficam onde o áudio disse; as demais
 * são interpoladas entre elas. Se o áudio mal reconheceu a letra (menos da
 * metade das linhas confiáveis), devolve `null` — letra parada é melhor que
 * letra correndo no lugar errado.
 */
export function aplicarAlinhamento(
  letra: Lyrics,
  indices: number[],
  alinhadas: LinhaAlinhada[],
): Lyrics | null {
  if (indices.length === 0 || alinhadas.length !== indices.length) return null;
  const porLinha = new Map<number, LinhaAlinhada>();
  indices.forEach((i, k) => porLinha.set(i, alinhadas[k] as LinhaAlinhada));
  const confiaveis = indices.filter((i) => confianca(porLinha.get(i)) >= LINHA_CONFIAVEL);
  if (confiaveis.length < Math.max(2, indices.length * 0.5)) return null;

  const ancoras: Array<{ i: number; d: number }> = [];
  if (letra.synced) {
    const brutos = confiaveis.map((i) => ({
      i,
      d: (porLinha.get(i) as LinhaAlinhada).startMs - (letra.lines[i] as LyricLine).timeMs,
    }));
    brutos.forEach((b, k) => {
      const vizinhas = brutos.slice(Math.max(0, k - 5), k + 6).map((x) => x.d);
      if (Math.abs(b.d - mediana(vizinhas)) <= OUTLIER_MS) ancoras.push(b);
    });
  } else {
    for (const i of confiaveis) ancoras.push({ i, d: (porLinha.get(i) as LinhaAlinhada).startMs });
  }
  if (ancoras.length === 0) return null;

  // `d` é deslocamento (letra com tempo) ou o próprio tempo (sem tempo).
  const interpolar = (i: number): number => {
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
      return antes.d + ((depois.d - antes.d) * (i - antes.i)) / (depois.i - antes.i);
    }
    return (antes ?? depois)!.d;
  };

  const usadas = new Set(ancoras.map((a) => a.i));
  let ultimo = 0;
  const lines: LyricLine[] = letra.lines.map((linha, i) => {
    const alinhada = porLinha.get(i);
    const real = usadas.has(i) && alinhada;
    let timeMs = real
      ? alinhada.startMs
      : Math.round(letra.synced ? linha.timeMs + interpolar(i) : interpolar(i));
    timeMs = Math.max(0, timeMs, ultimo);
    ultimo = timeMs;
    return { timeMs, text: linha.text };
  });
  // Palavra a palavra, com o limite de cada verso já conhecido (o início do
  // seguinte): nenhuma palavra pode passar dele.
  lines.forEach((linha, i) => {
    const alinhada = porLinha.get(i);
    if (!usadas.has(i) || !alinhada) return;
    const fim = lines[i + 1]?.timeMs ?? Number.POSITIVE_INFINITY;
    const words = temposDasPalavras(linha.text, alinhada.words, linha.timeMs, fim);
    if (words) linha.words = words;
  });
  return { ...letra, synced: true, lines };
}

/** Abaixo disto a palavra não tem tempo próprio: é interpolada entre vizinhas. */
const PALAVRA_ACHADA = 0.15;

const normalizarPalavra = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * O INSTANTE DE CADA PALAVRA DO TEXTO EXIBIDO — o que faz quem canta pela
 * primeira vez acompanhar sem tropeçar.
 *
 * O alinhador devolve palavras com tempo, mas não necessariamente uma para uma
 * com o texto da tela: pontuação, contração ("tô", "cê") e hífen mudam a
 * contagem. Antes, contagem diferente descartava o verso inteiro e a tela caía
 * na estimativa por sílabas. Agora:
 *
 *  1. casa por CONTEÚDO (sequência comum sobre a palavra normalizada), não por
 *     posição — palavra a mais ou a menos não desloca as seguintes;
 *  2. palavra que o modelo mal achou (confiança < 0,15) não tem tempo próprio:
 *     é interpolada entre as vizinhas confiáveis, pelo tamanho;
 *  3. garantias duras: tempos crescentes e dentro do verso — nunca antes do
 *     início dele, nunca no início do verso seguinte.
 *
 * Devolve `null` quando menos da metade das palavras tem âncora: aí a
 * estimativa por sílabas da tela (karaoke.ts) é mais honesta.
 */
export function temposDasPalavras(
  texto: string,
  alinhadas: PalavraAlinhada[],
  inicio: number,
  fim: number,
): Array<{ text: string; timeMs: number }> | null {
  const textos = texto.split(/\s+/).filter(Boolean);
  if (textos.length === 0 || alinhadas.length === 0) return null;
  const a = textos.map(normalizarPalavra);
  const b = alinhadas.map((w) => normalizarPalavra(w.text));

  // Sequência comum mais longa (versos são curtos: n·m é nada).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        a[i] && a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const tempo: Array<number | null> = new Array<number | null>(textos.length).fill(null);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] && a[i] === b[j]) {
      const w = alinhadas[j] as PalavraAlinhada;
      if (w.prob >= PALAVRA_ACHADA) tempo[i] = w.startMs;
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1;
    else j += 1;
  }
  // Âncora fora do verso ou fora de ordem não é âncora.
  let ultimaAncora = inicio;
  for (let k = 0; k < tempo.length; k += 1) {
    const t = tempo[k];
    if (t === null || t === undefined) continue;
    if (t < ultimaAncora || t >= fim) tempo[k] = null;
    else ultimaAncora = t;
  }
  const ancoradas = tempo.filter((t) => t !== null).length;
  if (ancoradas < Math.ceil(textos.length / 2)) return null;

  // A primeira palavra abre o verso; o que falta é interpolado pelo tamanho.
  tempo[0] = tempo[0] ?? inicio;
  const peso = textos.map((t) => Math.max(1, t.length));
  const fimUtil = Number.isFinite(fim) ? fim : ultimaAncora + 1_500;
  for (let k = 1; k < tempo.length; k += 1) {
    if (tempo[k] !== null) continue;
    let depois = k;
    while (depois < tempo.length && tempo[depois] === null) depois += 1;
    const t0 = tempo[k - 1] as number;
    const t1 =
      depois < tempo.length
        ? (tempo[depois] as number)
        : Math.min(fimUtil, t0 + 400 * (depois - k + 1));
    const total = peso.slice(k - 1, depois).reduce((s, p) => s + p, 0);
    let acumulado = 0;
    for (let m = k; m < depois; m += 1) {
      acumulado += peso[m - 1] as number;
      tempo[m] = Math.round(t0 + ((t1 - t0) * acumulado) / total);
    }
    k = depois;
  }
  let anterior = inicio;
  return textos.map((text, k) => {
    const t = Math.min(Math.max(tempo[k] as number, anterior), fim - 1);
    anterior = t;
    return { text, timeMs: t };
  });
}

/** URL do alinhamento da faixa, derivada da URL da cópia no cofre. */
export function urlDoAlinhamento(remoteUrl: string, idioma: string): string | null {
  const tempo = urlDoTempo(remoteUrl, idioma);
  return tempo ? tempo.replace(/\/tempo\?/, '/alinhar?') : null;
}

export type RespostaDoAlinhamento =
  | { tipo: 'pronto'; linhas: LinhaAlinhada[] }
  /**
   * `processando`: o job de alinhamento DESTA faixa está rodando agora no
   * importador (não só esperando vez na fila). É a diferença entre perguntar
   * de novo em ~2s (o trabalho pode terminar a qualquer instante) ou em 15s
   * (ainda nem começou, martelar não adianta nada).
   */
  | { tipo: 'esperar'; processando?: boolean }
  | { tipo: 'desistir' };

/** Pede o alinhamento destas linhas. Nunca lança. */
export async function buscarAlinhamento(
  url: string,
  linhas: string[],
): Promise<RespostaDoAlinhamento> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ linhas }),
    });
    if (res.status === 200) {
      const corpo = (await res.json()) as { linhas?: LinhaAlinhada[] };
      return corpo.linhas && corpo.linhas.length > 0
        ? { tipo: 'pronto', linhas: corpo.linhas }
        : { tipo: 'desistir' };
    }
    if (res.status === 202) {
      // O importador manda `status: 'processando' | 'na-fila'` no corpo (ver
      // server.mjs) — sem lê-lo aqui, todo 202 virava o mesmo "esperar" e o
      // laço em calibragem.ts perguntava de novo só depois de 15s mesmo com o
      // job rodando, que era exatamente a demora reclamada.
      const corpo = (await res.json().catch(() => ({}) as { status?: string })) as {
        status?: string;
      };
      return { tipo: 'esperar', processando: corpo.status === 'processando' };
    }
    if (res.status === 503) return { tipo: 'esperar' };
    return { tipo: 'desistir' };
  } catch {
    return { tipo: 'esperar' };
  }
}

// ── TRANSCRIÇÃO: último recurso, e sem inventar ──────────────────────────────

/** Confiança mínima para uma palavra transcrita aparecer na tela. */
const PALAVRA_CONFIAVEL = 0.6;

/**
 * Filtra a transcrição para o que o modelo de fato ouviu.
 *
 * Com sotaque e autotune, a transcrição inventa ("proprietary Passe Passe…").
 * Aqui só fica a palavra com confiança alta; e se a maior parte da música não
 * passa no filtro, não há letra — mostrar texto inventado é pior que mostrar
 * "sem letra". Palavra sem confiança informada (Riva) passa: o Riva só é usado
 * em inglês, onde reconhece bem.
 */
export function transcricaoConfiavel<T extends { text: string; startMs: number; prob?: number }>(
  palavras: T[],
): T[] | null {
  if (palavras.length === 0) return null;
  const boas = palavras.filter((p) => p.prob === undefined || p.prob >= PALAVRA_CONFIAVEL);
  return boas.length >= palavras.length * 0.7 && boas.length >= 20 ? boas : null;
}
