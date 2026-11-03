/**
 * KARAOKÊ: a palavra acesa nunca passa do verso seguinte, e uma janela longa
 * (solo de 12 s entre dois versos) não espalha as palavras por ela — o
 * destaque se arrastaria muito depois da voz.
 */
import { describe, expect, it } from 'vitest';
import { linhaAtiva, palavraAtiva, palavrasDaLinha, silabas } from '@/lib/lyrics/karaoke';

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

const VERSOS = [
  'Eu vou te levar pra onde o sol nasce',
  'Na quebrada o papo é reto',
  'Coração bateu mais forte quando você chegou',
  'I keep running through the night',
  'Hold me close and do not leave',
  'Tô',
  'Saudade de você me pega de manhã cedo quando acordo sozinho',
];

describe('palavrasDaLinha: estimativa nunca passa da próxima linha', () => {
  const rand = prng(1103);
  const casos = Array.from({ length: 40 }, (_, k) => ({
    k,
    texto: VERSOS[Math.floor(rand() * VERSOS.length)]!,
    inicio: Math.floor(rand() * 200_000),
    janela: [80, 300, 900, 1_500, 3_000, 6_000, 12_000, 30_000][Math.floor(rand() * 8)]!,
  }));
  it.each(casos)('caso $k: janela $janela ms', ({ texto, inicio, janela }) => {
    const proxima = inicio + janela;
    const p = palavrasDaLinha({ timeMs: inicio, text: texto }, proxima);
    expect(p.map((w) => w.text)).toEqual(texto.split(/\s+/));
    expect(p[0]!.timeMs).toBe(inicio);
    for (const w of p) {
      expect(w.timeMs).toBeGreaterThanOrEqual(inicio);
      expect(w.timeMs).toBeLessThan(proxima);
    }
    for (let i = 1; i < p.length; i += 1)
      expect(p[i]!.timeMs).toBeGreaterThanOrEqual(p[i - 1]!.timeMs);
    // Janela longa não espalha: a última palavra cai dentro do tempo cantável.
    const cantavel = texto.split(/\s+/).reduce((s, w) => s + silabas(w), 0) * 250 + 300;
    expect(p[p.length - 1]!.timeMs - inicio).toBeLessThanOrEqual(cantavel);
  });
});

describe('palavrasDaLinha: tempo real fora do verso é preso a ele', () => {
  const rand = prng(42);
  const casos = Array.from({ length: 20 }, (_, k) => ({
    k,
    deslize: Math.floor((rand() - 0.5) * 8_000),
  }));
  it.each(casos)('caso $k: palavras deslocadas $deslize ms', ({ deslize }) => {
    const inicio = 50_000;
    const proxima = 53_000;
    const words = ['eu', 'vou', 'ali', 'e', 'volto'].map((text, i) => ({
      text,
      timeMs: inicio + i * 700 + deslize,
    }));
    const p = palavrasDaLinha({ timeMs: inicio, text: 'eu vou ali e volto', words }, proxima);
    expect(p).toHaveLength(5);
    for (const w of p) {
      expect(w.timeMs).toBeGreaterThanOrEqual(inicio);
      expect(w.timeMs).toBeLessThan(proxima);
    }
    for (let i = 1; i < p.length; i += 1)
      expect(p[i]!.timeMs).toBeGreaterThanOrEqual(p[i - 1]!.timeMs);
  });

  it('palavras já dentro do verso voltam como vieram (mesma referência)', () => {
    const words = [
      { text: 'a', timeMs: 1_000 },
      { text: 'b', timeMs: 1_500 },
    ];
    expect(palavrasDaLinha({ timeMs: 1_000, text: 'a b', words }, 3_000)).toBe(words);
  });

  it('última linha (sem próxima): só não volta antes do início', () => {
    const p = palavrasDaLinha(
      {
        timeMs: 10_000,
        text: 'a b',
        words: [
          { text: 'a', timeMs: 9_000 },
          { text: 'b', timeMs: 99_000 },
        ],
      },
      null,
    );
    expect(p.map((w) => w.timeMs)).toEqual([10_000, 99_000]);
  });

  it('próxima linha no MESMO instante não esmaga a linha', () => {
    const p = palavrasDaLinha({ timeMs: 5_000, text: 'um dois' }, 5_000);
    expect(p[0]!.timeMs).toBe(5_000);
    expect(p[1]!.timeMs).toBeGreaterThan(5_000);
  });

  it('texto vazio: nenhuma palavra', () => {
    expect(palavrasDaLinha({ timeMs: 0, text: '   ' }, 1_000)).toEqual([]);
  });
});

describe('linhaAtiva / palavraAtiva: busca binária contra varredura', () => {
  const rand = prng(9);
  const casos = Array.from({ length: 20 }, (_, k) => {
    let t = 0;
    const linhas = Array.from({ length: 1 + Math.floor(rand() * 60) }, () => {
      t += Math.floor(rand() * 4_000);
      return { timeMs: t };
    });
    return { k, linhas, pos: Math.floor(rand() * (t + 5_000)) - 1_000 };
  });
  it.each(casos)('caso $k', ({ linhas, pos }) => {
    let esperado = -1;
    linhas.forEach((l, i) => {
      if (l.timeMs <= pos) esperado = i;
    });
    expect(linhaAtiva(linhas, pos)).toBe(esperado);
    expect(
      palavraAtiva(
        linhas.map((l) => ({ ...l, text: 'x' })),
        pos,
      ),
    ).toBe(esperado);
  });
});
