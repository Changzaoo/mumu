/**
 * A letra de verdade confirmada pela voz — com os dados REAIS de "Lembrei de
 * Tu": o que o importador ouviu (com os erros do autotune) e as candidatas do
 * LRCLIB com o mesmo título e músicas erradas do mesmo artista e gênero.
 */
import { describe, expect, it } from 'vitest';
import {
  COBERTURA_MINIMA,
  coberturaDaVoz,
  escolherPelaVoz,
  palavrasOuvidas,
} from '@/lib/lyrics/confirmarPelaVoz';
import type { LrclibRow } from '@/lib/lyrics/lyrics';
import real from './fixtures/lembreiDeTu.json';

const { words, rows, duracaoSeg } = real as {
  words: Array<{ text: string; prob: number }>;
  rows: LrclibRow[];
  duracaoSeg: number;
};
const texto = (r: LrclibRow): string => r.plainLyrics || r.syncedLyrics || '';
const porArtista = (nome: string, dur?: number): LrclibRow =>
  rows.find((r) => r.artistName === nome && (dur === undefined || r.duration === dur))!;

describe('confirmar a letra pela voz', () => {
  const ouvidas = palavrasOuvidas(words);

  it('a letra certa cobre o que foi ouvido; as erradas, não', () => {
    expect(coberturaDaVoz(ouvidas, texto(porArtista('Men0')))).toBeGreaterThan(COBERTURA_MINIMA);
    expect(coberturaDaVoz(ouvidas, texto(porArtista('MC Meno K', 173)))).toBeGreaterThan(
      COBERTURA_MINIMA,
    );
    for (const errada of rows.filter((r) => r.trackName !== 'Lembrei de Tu')) {
      expect(coberturaDaVoz(ouvidas, texto(errada))).toBeLessThan(COBERTURA_MINIMA);
    }
  });

  it('escolhe a versão com a duração desta gravação, com o relógio dela', () => {
    const letra = escolherPelaVoz(rows, words, duracaoSeg);
    expect(letra?.synced).toBe(true);
    expect(letra?.lines[0]?.text).toBe('Lembrei de tu, confesso não esqueci nunca');
    expect(letra?.lines[0]?.timeMs).toBe(740);
  });

  it('só outra gravação: fica o texto certo, sem o relógio de outra duração', () => {
    const letra = escolherPelaVoz([porArtista('MC Meno K', 173)], words, duracaoSeg);
    expect(letra).not.toBeNull();
    expect(letra?.synced).toBe(false);
    expect(letra?.lines.every((l) => l.timeMs === 0)).toBe(true);
  });

  it('só músicas erradas: nada (a transcrição segue como está)', () => {
    const erradas = rows.filter((r) => r.trackName !== 'Lembrei de Tu');
    expect(escolherPelaVoz(erradas, words, duracaoSeg)).toBeNull();
  });

  it('pouca coisa ouvida não prova nada', () => {
    expect(escolherPelaVoz(rows, words.slice(0, 10), duracaoSeg)).toBeNull();
  });
});
