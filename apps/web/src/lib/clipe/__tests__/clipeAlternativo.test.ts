/**
 * O CLIPE RESERVA É A MESMA MÚSICA, E NUNCA UM VÍDEO IMPRÓPRIO.
 *
 * Quando o oficial não aceita embed, o modo clipe procura outro vídeo. Estes
 * testes prendem o crivo: cai o que não é a música (outro artista, speed up),
 * cai o que tem marca de conteúdo adulto, o que já falhou não volta, e o canal
 * de quem falhou vai para o fim da fila.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { ordenarCandidatos, pareceImproprio } from '../clipeAlternativo';

const faixa = (title: string, artista: string, durSeg = 0): TrackDto =>
  ({
    id: 'local:x',
    title,
    durationMs: durSeg * 1000,
    artists: [{ id: '', name: artista, slug: '', imageUrl: null }],
  }) as unknown as TrackDto;
const r = (id: string, titulo: string, canal: string, duracaoSeg = 0) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  titulo,
  canal,
  duracaoSeg,
  capa: null,
});

const ids = (c: ReturnType<typeof ordenarCandidatos>) => c.map((x) => x.videoId);

describe('ordenarCandidatos', () => {
  it('só a mesma música entra; o que já falhou não volta', () => {
    const t = faixa('Isso é Sério', 'Matuê', 200);
    const saida = ordenarCandidatos(
      t,
      [
        r('OFICIAL0001', 'Matuê - Isso é Sério (Clipe Oficial)', 'Matuê'),
        r('LYRIC000001', 'Matuê - Isso é Sério (Letra)', 'Letras BR', 201),
        r('OUTRA000001', 'Isso é Sério', 'Outro Cantor', 150),
        r('SPEED000001', 'Matuê - Isso é Sério (speed up)', 'Matuê'),
        r('NADAAVER001', 'Vitrine', 'Matuê'),
      ],
      new Set(['OFICIAL0001']),
    );
    expect(ids(saida)).toEqual(['LYRIC000001']);
  });

  it('o canal do vídeo que falhou vai para o fim; VEVO também perde ponto', () => {
    const t = faixa('Mantém', 'Matuê', 180);
    const saida = ordenarCandidatos(
      t,
      [
        r('OFICIAL0002', 'Matuê - Mantém', 'Matuê', 180),
        r('AUDIO000002', 'Matuê - Mantém (Áudio)', 'Matuê', 180),
        r('VEVO0000002', 'Matuê - Mantém', 'MatueVEVO', 180),
        r('FAN00000002', 'Matuê - Mantém', 'Canal do Fã', 181),
      ],
      new Set(['OFICIAL0002']),
    );
    expect(ids(saida)).toEqual(['FAN00000002', 'VEVO0000002', 'AUDIO000002']);
  });

  it('vídeo com marca de conteúdo adulto fica de fora', () => {
    const t = faixa('Mantém', 'Matuê', 180);
    const saida = ordenarCandidatos(t, [
      r('ADULTO00001', 'Matuê - Mantém +18 sem censura', 'Putaria BR', 180),
      r('LIMPO000001', 'Matuê - Mantém', 'Canal do Fã', 180),
    ]);
    expect(ids(saida)).toEqual(['LIMPO000001']);
  });
});

describe('pareceImproprio', () => {
  it('a palavra que é do nome da própria música não condena o vídeo', () => {
    const t = faixa('Sexo Virtual', 'Banda X');
    expect(pareceImproprio(t, r('A', 'Banda X - Sexo Virtual (ao vivo)', 'Banda X'))).toBe(false);
    expect(pareceImproprio(t, r('B', 'Banda X - Sexo Virtual', 'Canal Porno'))).toBe(true);
  });

  it('"sexy" não é "sex"', () => {
    expect(pareceImproprio(faixa('Sexy', 'Y'), r('C', 'Y - Sexy (lyric)', 'Y'))).toBe(false);
  });
});
