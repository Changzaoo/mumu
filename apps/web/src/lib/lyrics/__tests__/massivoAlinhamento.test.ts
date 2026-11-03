/**
 * O RELÓGIO DA LETRA SOB TORTURA — geradores determinísticos (seed fixa).
 *
 * A letra do LRCLIB foi cronometrada para OUTRA gravação: introdução mais
 * longa ou mais curta (0,5 a 15 s), deriva linear (até 3%: a letra que "acaba
 * antes da música"), refrão repetido em que o alinhador encaixa a repetição
 * errada, metade das linhas com confiança baixa. O que se exige:
 *   - linha bem alinhada vai para o tempo do áudio (±0 ms: é o dado);
 *   - linha sem âncora herda o deslocamento interpolado (erro pequeno);
 *   - âncora que destoa (refrão na repetição errada) é descartada;
 *   - letra de OUTRA música devolve null — karaokê errado é pior que nenhum;
 *   - tempos nunca andam para trás e palavra nunca passa do verso seguinte.
 */
import { describe, expect, it } from 'vitest';
import type { Lyrics } from '@/lib/lyrics/lyrics';
import {
  aplicarAlinhamento,
  confiancaDoAlinhamento,
  linhasParaAlinhar,
  recalibrarLetra,
  type LinhaAlinhada,
} from '@/lib/lyrics/recalibrar';
import { alignLinesToSegments, alignLyrics, spreadLinesOverSpan } from '@/lib/lyrics/align';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PT = [
  'eu tô de volta com a mente de um chefe',
  'basta o meu verso e ela se derrete',
  'descarrego minha raiva no teclado',
  'na quebrada o papo é reto parceiro',
  'coração bateu mais forte quando você chegou',
  'saudade me pega toda manhã',
  'ela dança e o mundo inteiro para',
  'não é dinheiro é a paz que eu quero',
  'mantém mantém que o jogo é nosso',
  'vou subir de nave pra lua cheia',
  'minha mãe falou meu filho vai com calma',
  'o bonde tá formado e ninguém segura',
];
const EN = [
  'i keep running through the night',
  'never let me go tonight baby',
  'you are all i need right now',
  'under the city lights we fly',
  'hold me close and do not leave',
  'we were young and we were free',
  'tell me what you want from me',
  'dancing in the dark again',
];
const REFRAO = 'mantém mantém que o jogo é nosso';

interface Cenario {
  letra: Lyrics;
  /** Instante REAL de cada linha no áudio. */
  verdade: number[];
}

/** Letra com tempo do LRCLIB e a verdade do áudio: intro + deriva. */
function cenario(rand: () => number, introMs: number, deriva: number, n: number): Cenario {
  const versos = rand() < 0.5 ? PT : EN;
  let t = 18_000;
  const lrc: number[] = [];
  for (let i = 0; i < n; i += 1) {
    lrc.push(t);
    t += 2_500 + Math.floor(rand() * 3_000);
  }
  const verdade = lrc.map((x) => Math.round(introMs + x * (1 + deriva)));
  const letra: Lyrics = {
    synced: true,
    source: null,
    lines: lrc.map((timeMs, i) => ({ timeMs, text: versos[i % versos.length]! })),
  };
  return { letra, verdade };
}

/** O que o alinhador devolveria: palavra a palavra a partir do tempo real. */
function alinhar(texto: string, inicio: number, prob: number): LinhaAlinhada {
  const palavras = texto.split(' ');
  return {
    startMs: inicio,
    endMs: inicio + palavras.length * 280,
    words: palavras.map((w, k) => ({
      text: w,
      startMs: inicio + k * 280,
      endMs: inicio + k * 280 + 250,
      prob,
    })),
  };
}

function monotono(lines: { timeMs: number }[]): boolean {
  return lines.every((l, i) => i === 0 || l.timeMs >= lines[i - 1]!.timeMs);
}

function palavrasDentro(lyrics: Lyrics): boolean {
  return lyrics.lines.every((l, i) => {
    const fim = lyrics.lines[i + 1]?.timeMs ?? Number.POSITIVE_INFINITY;
    return (l.words ?? []).every(
      (w) => w.timeMs >= l.timeMs && w.timeMs < Math.max(fim, l.timeMs + 1),
    );
  });
}

// ── intro de 0,5 a 15 s (mais longa E mais curta) × deriva até 3% ──────────
describe('aplicarAlinhamento: intro diferente e deriva linear', () => {
  const rand = prng(31_337);
  const intros = [500, 1_000, 2_500, 4_000, 7_500, 11_600, 15_000];
  const derivas = [0, 0.005, 0.01, 0.02, 0.03];
  const casos = intros.flatMap((intro) =>
    [1, -1].flatMap((sinal) =>
      derivas.map((deriva) => ({ intro: intro * sinal, deriva, n: 8 + Math.floor(rand() * 25) })),
    ),
  );
  it.each(casos)('intro $intro ms, deriva $deriva, $n linhas', ({ intro, deriva, n }) => {
    const { letra, verdade } = cenario(rand, intro, deriva, n);
    const indices = linhasParaAlinhar(letra);
    const alinhadas = indices.map((i) => alinhar(letra.lines[i]!.text, verdade[i]!, 0.85));
    const r = aplicarAlinhamento(letra, indices, alinhadas);
    expect(r).not.toBeNull();
    expect(r!.lines.map((l) => l.timeMs)).toEqual(verdade);
    expect(r!.lines.map((l) => l.text)).toEqual(letra.lines.map((l) => l.text));
    expect(monotono(r!.lines)).toBe(true);
    expect(palavrasDentro(r!)).toBe(true);
    expect(confiancaDoAlinhamento(indices, alinhadas)).toBeCloseTo(0.85, 5);
  });
});

// ── linhas sem âncora herdam o deslocamento interpolado ─────────────────────
describe('aplicarAlinhamento: linhas fracas são interpoladas perto da verdade', () => {
  const rand = prng(4242);
  const casos = Array.from({ length: 24 }, (_, k) => ({
    k,
    intro: Math.floor((rand() - 0.3) * 20_000),
    deriva: rand() * 0.03,
    n: 12 + Math.floor(rand() * 20),
    fracas: 0.1 + rand() * 0.35,
  }));
  it.each(casos)('caso $k: intro $intro, $n linhas', ({ intro, deriva, n, fracas }) => {
    const { letra, verdade } = cenario(rand, Math.max(intro, -15_000), deriva, n);
    const indices = linhasParaAlinhar(letra);
    // ~1/3 a 1/2 das linhas fracas, nunca a primeira nem a última nem duas
    // seguidas (a regra dos 50% de confiáveis é testada à parte).
    const passo = fracas < 0.25 ? 3 : 2;
    const fraca = indices.map((_, k) => k > 0 && k < indices.length - 1 && k % passo === 1);
    const alinhadas = indices.map((i, k) =>
      alinhar(
        letra.lines[i]!.text,
        fraca[k] ? verdade[i]! + 9_000 : verdade[i]!,
        fraca[k] ? 0.1 : 0.8,
      ),
    );
    const r = aplicarAlinhamento(letra, indices, alinhadas);
    expect(r).not.toBeNull();
    r!.lines.forEach((l, i) => {
      const erro = Math.abs(l.timeMs - verdade[i]!);
      // âncora: exato; interpolada: erro só da deriva entre vizinhas
      expect(erro).toBeLessThanOrEqual(fraca[i] ? 450 : 0);
      if (fraca[i]) expect(l.words).toBeUndefined();
    });
    expect(monotono(r!.lines)).toBe(true);
  });
});

// ── refrão repetido casando com a repetição errada ──────────────────────────
describe('aplicarAlinhamento: refrão encaixado na repetição errada é descartado', () => {
  const rand = prng(777);
  const casos = Array.from({ length: 16 }, (_, k) => ({
    k,
    intro: Math.floor(rand() * 12_000),
    salto: 20_000 + Math.floor(rand() * 20_000),
  }));
  it.each(casos)('caso $k: refrão pula $salto ms', ({ intro, salto }) => {
    const textos = [...PT.slice(0, 4), REFRAO, ...PT.slice(4, 8), REFRAO, ...PT.slice(8, 12)];
    const lrc = textos.map((_, i) => 18_000 + i * 4_000);
    const verdade = lrc.map((t) => t + intro);
    const letra: Lyrics = {
      synced: true,
      source: null,
      lines: textos.map((text, i) => ({ timeMs: lrc[i]!, text })),
    };
    const indices = linhasParaAlinhar(letra);
    const errado = 4; // o 1º refrão foi encaixado na 2ª repetição
    const alinhadas = indices.map((i) =>
      alinhar(letra.lines[i]!.text, i === errado ? verdade[i]! + salto : verdade[i]!, 0.9),
    );
    const r = aplicarAlinhamento(letra, indices, alinhadas)!;
    expect(Math.abs(r.lines[errado]!.timeMs - verdade[errado]!)).toBeLessThanOrEqual(10);
    expect(r.lines[errado]!.words).toBeUndefined();
    expect(monotono(r.lines)).toBe(true);
  });
});

// ── metade das linhas com confiança baixa ───────────────────────────────────
describe('aplicarAlinhamento: o limite de 50% de linhas confiáveis', () => {
  const rand = prng(2024);
  const casos = Array.from({ length: 12 }, (_, k) => ({ k, n: 10 + 2 * Math.floor(rand() * 10) }));
  it.each(casos)('caso $k ($n linhas): 50% fracas ainda passa, 60% não', ({ n }) => {
    const { letra, verdade } = cenario(rand, 3_000, 0.01, n);
    const indices = linhasParaAlinhar(letra);
    const metade = indices.map((i, k) =>
      alinhar(letra.lines[i]!.text, verdade[i]!, k % 2 ? 0.1 : 0.8),
    );
    expect(aplicarAlinhamento(letra, indices, metade)).not.toBeNull();
    const corte = Math.ceil(indices.length * 0.6);
    const maioria = indices.map((i, k) =>
      alinhar(letra.lines[i]!.text, verdade[i]!, k < corte ? 0.1 : 0.8),
    );
    expect(aplicarAlinhamento(letra, indices, maioria)).toBeNull();
  });
});

// ── letra de outra música ───────────────────────────────────────────────────
describe('letra de OUTRA música devolve null', () => {
  const rand = prng(13);
  const casos = Array.from({ length: 12 }, (_, k) => ({ k, n: 8 + Math.floor(rand() * 16) }));
  it.each(casos)('aplicarAlinhamento, caso $k: alinhador mal acha o texto', ({ n }) => {
    const { letra, verdade } = cenario(rand, 0, 0, n);
    const indices = linhasParaAlinhar(letra);
    const alinhadas = indices.map((i) => alinhar(letra.lines[i]!.text, verdade[i]!, rand() * 0.25));
    expect(aplicarAlinhamento(letra, indices, alinhadas)).toBeNull();
    expect(confiancaDoAlinhamento(indices, alinhadas)).toBeLessThan(0.3);
  });
  it.each(casos)('recalibrarLetra, caso $k: o ASR ouviu outra letra', ({ n }) => {
    const { letra } = cenario(rand, 0, 0, n);
    const outra = (
      letra.lines[0]!.text.startsWith('i ') || EN.includes(letra.lines[0]!.text) ? PT : EN
    ).flatMap((v, i) => v.split(' ').map((w, k) => ({ text: w, startMs: i * 4000 + k * 300 })));
    const embaralhada = outra.map((w, i) => ({ ...w, text: `${w.text}${i % 3 ? 'x' : ''}` }));
    expect(recalibrarLetra(letra, embaralhada)).toBeNull();
  });
  it('tamanhos diferentes (linhas a mais/a menos) devolvem null', () => {
    const { letra, verdade } = cenario(prng(1), 0, 0, 6);
    const indices = linhasParaAlinhar(letra);
    const alinhadas = indices.map((i) => alinhar(letra.lines[i]!.text, verdade[i]!, 0.9));
    expect(aplicarAlinhamento(letra, indices, alinhadas.slice(1))).toBeNull();
    expect(aplicarAlinhamento(letra, [], [])).toBeNull();
  });
});

// ── recalibrarLetra pelas palavras do ASR (deriva + intro) ──────────────────
describe('recalibrarLetra: ASR com palavras perdidas e inventadas', () => {
  const rand = prng(555);
  const casos = Array.from({ length: 20 }, (_, k) => ({
    k,
    intro: Math.floor((rand() - 0.5) * 20_000),
    deriva: rand() * 0.03,
    perda: rand() * 0.3,
  }));
  it.each(casos)('caso $k: intro $intro, perda $perda', ({ intro, deriva, perda }) => {
    const { letra, verdade } = cenario(rand, intro, deriva, 10);
    const palavras = letra.lines.flatMap((l, i) =>
      l.text
        .split(' ')
        .map((w, k) => ({ text: w, startMs: verdade[i]! + k * 300 }))
        .filter((_, k) => k === 0 || rand() > perda),
    );
    // "yeah" fantasma no meio
    palavras.splice(5, 0, { text: 'yeah', startMs: palavras[4]!.startMs + 10 });
    const r = recalibrarLetra(letra, palavras);
    expect(r).not.toBeNull();
    r!.lines.forEach((l, i) => expect(Math.abs(l.timeMs - verdade[i]!)).toBeLessThanOrEqual(600));
    expect(monotono(r!.lines)).toBe(true);
  });
});

// ── transcrição por segmentos de 30 s (caminho pt-BR antigo) ────────────────
describe('alignLinesToSegments: cada linha dentro de uma janela de 30 s', () => {
  const rand = prng(30);
  const casos = Array.from({ length: 16 }, (_, k) => ({
    k,
    linhas: 6 + Math.floor(rand() * 40),
    segs: 2 + Math.floor(rand() * 8),
    inicio: Math.floor(rand() * 15_000),
  }));
  it.each(casos)('caso $k: $linhas linhas em $segs segmentos', ({ linhas, segs, inicio }) => {
    const textos = Array.from({ length: linhas }, (_, i) => PT[i % PT.length]!);
    const segmentos = Array.from({ length: segs }, (_, i) => ({
      text: PT.slice(0, 1 + Math.floor(rand() * 4)).join(' '),
      startMs: inicio + i * 30_000,
      endMs: inicio + (i + 1) * 30_000,
    }));
    const r = alignLinesToSegments(textos, segmentos)!;
    expect(r).toHaveLength(linhas);
    expect(monotono(r)).toBe(true);
    expect(r[0]!.timeMs).toBeGreaterThanOrEqual(inicio);
    expect(r[r.length - 1]!.timeMs).toBeLessThan(inicio + segs * 30_000);
  });
  it('sem segmento com texto: null', () => {
    expect(alignLinesToSegments(['a'], [{ text: '♪', startMs: 0, endMs: 30_000 }])).toBeNull();
    expect(alignLinesToSegments([], [{ text: 'a', startMs: 0, endMs: 30_000 }])).toBeNull();
  });
  it('spreadLinesOverSpan reparte pelo tamanho e começa no início', () => {
    const r = spreadLinesOverSpan(['aa', 'aaaa', 'aa'], 1_000, 9_000);
    expect(r.map((l) => l.timeMs)).toEqual([1_000, 3_000, 7_000]);
  });
  it('alignLyrics com ASR vazio ou letra vazia: null', () => {
    expect(alignLyrics([], [{ text: 'a', startMs: 0 }])).toBeNull();
    expect(alignLyrics(['a'], [])).toBeNull();
  });
});

// ── letra sem tempo ganha o tempo do áudio ──────────────────────────────────
describe('aplicarAlinhamento: letra SEM tempo', () => {
  const rand = prng(808);
  const casos = Array.from({ length: 10 }, (_, k) => ({ k, n: 6 + Math.floor(rand() * 14) }));
  it.each(casos)('caso $k: $n linhas', ({ n }) => {
    const { letra, verdade } = cenario(rand, 5_000, 0.02, n);
    const plana: Lyrics = {
      ...letra,
      synced: false,
      lines: letra.lines.map((l) => ({ ...l, timeMs: 0 })),
    };
    const indices = linhasParaAlinhar(plana);
    const alinhadas = indices.map((i, k) =>
      alinhar(plana.lines[i]!.text, verdade[i]!, k === 2 ? 0.05 : 0.9),
    );
    const r = aplicarAlinhamento(plana, indices, alinhadas)!;
    expect(r.synced).toBe(true);
    r.lines.forEach((l, i) => {
      if (i === 2) {
        expect(l.timeMs).toBeGreaterThan(verdade[1]!);
        expect(l.timeMs).toBeLessThan(verdade[3]!);
      } else expect(l.timeMs).toBe(verdade[i]);
    });
  });
});
