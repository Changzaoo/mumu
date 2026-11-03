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
  if (linha.words && linha.words.length > 0)
    return dentroDaLinha(linha.words, linha.timeMs, proximaMs);
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

/**
 * Palavra com tempo real ainda tem de caber NA LINHA: o verso foi movido
 * (recalibrado, monotonicidade) e as palavras às vezes ficavam com o tempo de
 * antes — antes do início dele ou já no verso seguinte, e o destaque pulava
 * de volta ou acendia a palavra errada. Prende cada uma entre o início da
 * linha e 1 ms antes da próxima, em ordem não decrescente.
 */
function dentroDaLinha(
  words: PalavraComTempo[],
  inicioMs: number,
  proximaMs: number | null,
): PalavraComTempo[] {
  const teto =
    proximaMs !== null && proximaMs > inicioMs ? proximaMs - 1 : Number.POSITIVE_INFINITY;
  let anterior = inicioMs;
  let mudou = false;
  const saida = words.map((w) => {
    const t = Math.min(Math.max(w.timeMs, anterior), teto);
    anterior = t;
    if (t === w.timeMs) return w;
    mudou = true;
    return { ...w, timeMs: t };
  });
  return mudou ? saida : words;
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

/**
 * LRC ESTENDIDO ("A2"): `[00:12.00]<00:12.00>Eu <00:12.40>vou <00:12.90>ali` —
 * texto limpo e o tempo real de cada palavra. Mora em packages/shared/src/letra
 * (o script Node também lê LRC).
 */
export { lerPalavrasMarcadas } from '@radinho/shared';

/**
 * VOZ DE FUNDO — o que a letra põe entre parênteses ("tô aqui (tô aqui)") é o
 * coro, o eco, o ad-lib: outra voz, por cima da principal. Aparece diferente
 * para quem acompanha saber que não é a voz que lidera.
 *
 * `trechosDaLinha` corta o texto em pedaços de voz principal e de fundo (os
 * parênteses ficam no pedaço de fundo); `palavrasDeFundo` diz, palavra a
 * palavra, quais estão dentro dos parênteses — um parêntese aberto numa
 * palavra vale até a palavra que o fecha. Parêntese que nunca fecha vale até o
 * fim da linha, que é como a letra costuma ser escrita.
 */
export function trechosDaLinha(texto: string): Array<{ texto: string; fundo: boolean }> {
  const trechos: Array<{ texto: string; fundo: boolean }> = [];
  let resto = texto;
  while (resto) {
    const abre = resto.indexOf('(');
    if (abre < 0) {
      trechos.push({ texto: resto, fundo: false });
      break;
    }
    if (abre > 0) trechos.push({ texto: resto.slice(0, abre), fundo: false });
    const fecha = resto.indexOf(')', abre);
    const fim = fecha < 0 ? resto.length : fecha + 1;
    trechos.push({ texto: resto.slice(abre, fim), fundo: true });
    resto = resto.slice(fim);
  }
  return trechos;
}

export function palavrasDeFundo(palavras: readonly { text: string }[]): boolean[] {
  let dentro = false;
  return palavras.map(({ text }) => {
    const abre = text.lastIndexOf('(');
    const fecha = text.lastIndexOf(')');
    const comeca = abre >= 0;
    const fundo = dentro || comeca;
    if (comeca && fecha < abre) dentro = true;
    else if (fecha >= 0) dentro = false;
    return fundo;
  });
}
