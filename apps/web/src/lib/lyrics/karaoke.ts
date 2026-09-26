/**
 * KARAOKÊ — onde a voz está, linha E palavra.
 *
 * O LRCLIB, fonte da maioria das letras, dá tempo por LINHA. Sem tempo por
 * palavra a linha inteira acende de uma vez e fica parada segundos, e a pessoa
 * não sabe onde a voz está dentro dela. Aqui cada linha ganha tempo por
 * palavra, na melhor fonte disponível:
 *
 *   1. o tempo REAL (alinhamento pelo áudio, ou LRC estendido `<mm:ss.xx>`);
 *   2. uma ESTIMATIVA: a janela da linha repartida pelas sílabas de cada
 *      palavra — palavra longa demora mais para ser cantada.
 *
 * A estimativa nunca usa a janela inteira até a próxima linha quando ela é
 * longa: um solo de 12 s entre dois versos não é tempo de canto, e espalhar as
 * palavras por ele deixaria o destaque se arrastando muito depois da voz.
 *
 * Tudo aqui é puro (sem DOM, sem rede) para ser testado sem navegador.
 */

export interface PalavraComTempo {
  text: string;
  timeMs: number;
}

export interface LinhaDeLetra {
  timeMs: number;
  text: string;
  words?: PalavraComTempo[];
}

/** Ritmo típico de canto: ~4 sílabas por segundo. */
const MS_POR_SILABA = 250;
/** Folga no fim da linha — a última palavra costuma ser sustentada. */
const FOLGA_MS = 300;

/** Sílabas aproximadas: grupos de vogais (com acento), ao menos uma. */
export function silabas(palavra: string): number {
  const grupos = palavra.toLowerCase().match(/[aeiouyáàâãéêíóôõúü]+/g);
  return Math.max(1, grupos?.length ?? 0);
}

/**
 * Tempo de cada palavra da linha. `proximaMs` é o início da linha seguinte
 * (ou `null` na última). Palavras com tempo real são devolvidas como vieram.
 */
export function palavrasDaLinha(linha: LinhaDeLetra, proximaMs: number | null): PalavraComTempo[] {
  if (linha.words && linha.words.length > 0) return linha.words;
  const textos = linha.text.split(/\s+/).filter(Boolean);
  if (textos.length === 0) return [];
  const pesos = textos.map(silabas);
  const totalSilabas = pesos.reduce((a, b) => a + b, 0);
  const cantavel = totalSilabas * MS_POR_SILABA + FOLGA_MS;
  const janela =
    proximaMs !== null && proximaMs > linha.timeMs
      ? Math.min(proximaMs - linha.timeMs, cantavel)
      : cantavel;
  const saida: PalavraComTempo[] = [];
  let acumulado = 0;
  for (let i = 0; i < textos.length; i++) {
    saida.push({
      text: textos[i] as string,
      timeMs: Math.round(linha.timeMs + (acumulado / totalSilabas) * janela),
    });
    acumulado += pesos[i] as number;
  }
  return saida;
}

/** Última linha cujo tempo já chegou; -1 antes da primeira. Busca binária. */
export function linhaAtiva(linhas: readonly { timeMs: number }[], posMs: number): number {
  let lo = 0;
  let hi = linhas.length - 1;
  let achada = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if ((linhas[meio] as { timeMs: number }).timeMs <= posMs) {
      achada = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achada;
}

/** Última palavra cujo tempo já chegou; -1 antes da primeira. */
export function palavraAtiva(palavras: readonly PalavraComTempo[], posMs: number): number {
  return linhaAtiva(palavras, posMs);
}

const TAG_DE_PALAVRA = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;

/**
 * LRC ESTENDIDO ("A2"): `[00:12.00]<00:12.00>Eu <00:12.40>vou <00:12.90>ali`.
 *
 * Antes estas marcas passavam direto para a tela, como texto. Devolve o texto
 * limpo e, quando havia marcas, o tempo real de cada palavra.
 */
export function lerPalavrasMarcadas(
  bruto: string,
  offsetMs: number,
): { text: string; words?: PalavraComTempo[] } {
  TAG_DE_PALAVRA.lastIndex = 0;
  if (!TAG_DE_PALAVRA.test(bruto)) return { text: bruto.trim() };
  TAG_DE_PALAVRA.lastIndex = 0;
  const words: PalavraComTempo[] = [];
  const partes = bruto.split(TAG_DE_PALAVRA);
  // split com 3 grupos: [texto, min, seg, frac, texto, min, seg, frac, texto…]
  for (let i = 1; i + 3 < partes.length + 1; i += 4) {
    const min = Number(partes[i]);
    const seg = Number(partes[i + 1]);
    const frac = partes[i + 2] ? Number(`${partes[i + 2]}000`.slice(0, 3)) : 0;
    const t = Math.max(0, (min * 60 + seg) * 1000 + frac - offsetMs);
    for (const texto of (partes[i + 3] ?? '').split(/\s+/).filter(Boolean)) {
      words.push({ text: texto, timeMs: t });
    }
  }
  const text = bruto.replace(TAG_DE_PALAVRA, '').replace(/\s+/g, ' ').trim();
  return words.length > 0 ? { text, words } : { text };
}
