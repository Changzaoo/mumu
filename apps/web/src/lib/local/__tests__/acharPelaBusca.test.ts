/**
 * O último recurso escolhe a MESMA música — nunca outra no lugar.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { melhorResultado, notaDoResultado } from '@/lib/local/acharPelaBusca';

const faixa = (title: string, artista: string, durSeg = 0): TrackDto =>
  ({
    id: 'local:x',
    title,
    durationMs: durSeg * 1000,
    artists: [{ id: '', name: artista, slug: '', imageUrl: null }],
  }) as unknown as TrackDto;
const r = (titulo: string, canal: string, duracaoSeg = 0) => ({
  url: `https://www.youtube.com/watch?v=${Math.random().toString(36).slice(2, 13).padEnd(11, 'a')}`,
  titulo,
  canal,
  duracaoSeg,
  capa: null,
});

describe('achar a mesma música pela busca', () => {
  it('título + artista: é ela', () => {
    expect(
      notaDoResultado(
        faixa('Isso é Sério', 'Matuê'),
        r('Matuê - Isso é Sério (Áudio Oficial)', 'Matuê'),
      ),
    ).toBeGreaterThan(0);
  });

  it('título + duração, mesmo com o canal de outro nome', () => {
    expect(
      notaDoResultado(
        faixa('Horse With No Name', 'America', 250),
        r('A Horse With No Name', 'Topic Music', 252),
      ),
    ).toBeGreaterThan(0);
  });

  it('título igual de OUTRO artista e outra duração: não é ela', () => {
    expect(notaDoResultado(faixa('Mantém', 'Matuê', 200), r('Mantém', 'Outro Cantor', 150))).toBe(
      0,
    );
  });

  it('versão mexida fica de fora', () => {
    expect(notaDoResultado(faixa('Mantém', 'Matuê'), r('Matuê - Mantém (speed up)', 'Matuê'))).toBe(
      0,
    );
  });

  it('sem o título no vídeo: não é ela', () => {
    expect(notaDoResultado(faixa('Mantém', 'Matuê'), r('Matuê - Kenny G', 'Matuê'))).toBe(0);
  });

  it('entre várias, a de título exato e duração batendo', () => {
    const t = faixa('Mantém', 'Matuê', 200);
    const certo = r('Matuê - Mantém', 'Matuê', 201);
    const escolhido = melhorResultado(t, [
      r('Matuê - Mantém (Remix)', 'Canal', 320),
      certo,
      r('Matuê - Mantém (8D)', 'Matuê', 200),
    ]);
    expect(escolhido).toBe(certo);
  });
});
