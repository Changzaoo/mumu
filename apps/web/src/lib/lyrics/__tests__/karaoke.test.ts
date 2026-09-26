import { describe, expect, it } from 'vitest';
import {
  lerPalavrasMarcadas,
  linhaAtiva,
  palavraAtiva,
  palavrasDaLinha,
  silabas,
} from '@/lib/lyrics/karaoke';

describe('karaokê: onde a voz está', () => {
  it('conta sílabas por grupo de vogais, com acento', () => {
    expect(silabas('eu')).toBe(1);
    expect(silabas('coração')).toBe(3);
    expect(silabas('amanhã')).toBe(3);
    expect(silabas('pff')).toBe(1);
  });

  it('palavra com tempo real sai como veio', () => {
    const words = [
      { text: 'a', timeMs: 1000 },
      { text: 'b', timeMs: 1700 },
    ];
    expect(palavrasDaLinha({ timeMs: 1000, text: 'a b', words }, 5000)).toBe(words);
  });

  it('sem tempo por palavra, reparte a linha pelas sílabas, em ordem', () => {
    const p = palavrasDaLinha({ timeMs: 10_000, text: 'eu te amo demais' }, 14_000);
    expect(p.map((w) => w.text)).toEqual(['eu', 'te', 'amo', 'demais']);
    expect(p[0]?.timeMs).toBe(10_000);
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.timeMs).toBeGreaterThan(p[i - 1]!.timeMs);
    }
    // "demais" (2 sílabas) começa depois de 4 das 6 sílabas da linha.
    expect(p[3]!.timeMs).toBeLessThan(14_000);
  });

  it('um solo longo depois do verso NÃO arrasta o destaque das palavras', () => {
    // 4 sílabas cantadas; próxima linha só 20 s depois.
    const p = palavrasDaLinha({ timeMs: 0, text: 'vai ser assim' }, 20_000);
    // Tempo cantável ≈ 4 × 250 + 300 ms — a última palavra começa bem antes de 2 s.
    expect(p.at(-1)!.timeMs).toBeLessThan(2_000);
  });

  it('linha ativa: a última cujo tempo já chegou', () => {
    const linhas = [{ timeMs: 1000 }, { timeMs: 3000 }, { timeMs: 6000 }];
    expect(linhaAtiva(linhas, 500)).toBe(-1);
    expect(linhaAtiva(linhas, 1000)).toBe(0);
    expect(linhaAtiva(linhas, 2999)).toBe(0);
    expect(linhaAtiva(linhas, 3000)).toBe(1);
    expect(linhaAtiva(linhas, 99_999)).toBe(2);
    expect(linhaAtiva([], 100)).toBe(-1);
  });

  it('palavra ativa acompanha o tempo dentro da linha', () => {
    const p = [
      { text: 'a', timeMs: 0 },
      { text: 'b', timeMs: 400 },
      { text: 'c', timeMs: 900 },
    ];
    expect(palavraAtiva(p, 399)).toBe(0);
    expect(palavraAtiva(p, 400)).toBe(1);
    expect(palavraAtiva(p, 1200)).toBe(2);
  });

  it('LRC estendido: marcas de palavra viram tempo, não texto na tela', () => {
    const r = lerPalavrasMarcadas('<00:12.00>Eu <00:12.40>vou <00:12.90>ali', 0);
    expect(r.text).toBe('Eu vou ali');
    expect(r.words).toEqual([
      { text: 'Eu', timeMs: 12_000 },
      { text: 'vou', timeMs: 12_400 },
      { text: 'ali', timeMs: 12_900 },
    ]);
  });

  it('LRC estendido respeita o [offset:]', () => {
    const r = lerPalavrasMarcadas('<00:10.00>oi', 500);
    expect(r.words).toEqual([{ text: 'oi', timeMs: 9_500 }]);
  });

  it('linha comum passa intacta', () => {
    expect(lerPalavrasMarcadas('  só texto  ', 0)).toEqual({ text: 'só texto' });
  });
});
