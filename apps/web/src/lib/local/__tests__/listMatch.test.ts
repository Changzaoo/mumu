import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import { matchLinesToLibrary, normalizeName, parseLines, splitLine } from '@/lib/local/listMatch';

function track(id: string, title: string, ...artists: string[]): TrackDto {
  return {
    id,
    title,
    artists: artists.map((name, i) => ({
      id: `a${i}`,
      name,
      handle: name,
      avatarUrl: null,
    })),
    album: null,
    durationMs: 200_000,
    coverUrl: null,
    streamUrl: null,
  } as unknown as TrackDto;
}

describe('normalizeName', () => {
  it('ignora caixa, acento e pontuação', () => {
    expect(normalizeName('Não Vou Chorar!')).toBe('nao vou chorar');
    expect(normalizeName('  AC/DC  ')).toBe('ac dc');
  });
});

describe('parseLines', () => {
  it('descarta linhas vazias e respeita o teto', () => {
    expect(parseLines('a\n\n  \nb')).toEqual(['a', 'b']);
    expect(parseLines('a\nb\nc', 2)).toEqual(['a', 'b']);
  });
});

describe('splitLine', () => {
  it('quebra em hífen, en dash e em dash', () => {
    expect(splitLine('Paint The Town Red - Doja Cat')).toEqual({
      title: 'Paint The Town Red',
      artist: 'Doja Cat',
    });
    expect(splitLine('Titulo – Artista').artist).toBe('Artista');
    expect(splitLine('Titulo — Artista').artist).toBe('Artista');
  });

  it('sem separador, a linha inteira é o título', () => {
    expect(splitLine('Enjoy the Silence')).toEqual({ title: 'Enjoy the Silence', artist: '' });
  });

  it('não quebra em hífen colado dentro do nome', () => {
    expect(splitLine('Jay-Z Song')).toEqual({ title: 'Jay-Z Song', artist: '' });
  });
});

describe('matchLinesToLibrary', () => {
  const library = [
    track('local:1', 'Enjoy the Silence', 'Depeche Mode'),
    track('local:2', 'Runnin', '21 Savage', 'Metro Boomin'),
    track('local:3', 'Paint The Town Red', 'Doja Cat'),
  ];

  it('casa título + artista mesmo com caixa e acento diferentes', () => {
    const { matched, missing } = matchLinesToLibrary(
      ['enjoy the silence - depeche mode', 'Paint the Town Red - Doja Cat'],
      library,
    );
    expect(matched.map((t) => t.id)).toEqual(['local:1', 'local:3']);
    expect(missing).toEqual([]);
  });

  it('casa por artista secundário', () => {
    const { matched } = matchLinesToLibrary(['Runnin - Metro Boomin'], library);
    expect(matched.map((t) => t.id)).toEqual(['local:2']);
  });

  it('casa só pelo título quando não há artista na linha', () => {
    const { matched } = matchLinesToLibrary(['Enjoy the Silence'], library);
    expect(matched.map((t) => t.id)).toEqual(['local:1']);
  });

  it('NUNCA inventa substituto: linha sem dona vira "missing"', () => {
    const { matched, missing } = matchLinesToLibrary(
      ['Musica Que Nao Tenho - Fulano', 'Runnin - 21 Savage'],
      library,
    );
    expect(matched.map((t) => t.id)).toEqual(['local:2']);
    expect(missing).toEqual(['Musica Que Nao Tenho - Fulano']);
  });

  it('não repete a mesma faixa citada duas vezes', () => {
    const { matched } = matchLinesToLibrary(
      ['Enjoy the Silence - Depeche Mode', 'Enjoy the Silence'],
      library,
    );
    expect(matched.map((t) => t.id)).toEqual(['local:1']);
  });

  it('biblioteca vazia devolve tudo como faltante', () => {
    const { matched, missing } = matchLinesToLibrary(['A - B'], []);
    expect(matched).toEqual([]);
    expect(missing).toEqual(['A - B']);
  });
});
