/**
 * "Em alta": as decisões puras — ler cada parada, fundir por música, dar
 * gênero e veredito de conteúdo, marcar o que o acervo já tem.
 */
import { describe, expect, it } from 'vitest';
import {
  chaveDaMusica,
  conteudoDasFontes,
  entradasDaApple,
  entradasDoDeezer,
  entradasDoYoutube,
  fundirParadas,
  generoDoFunkDaApple,
  generoDoRapFunk,
  idsDoRssDaApple,
  type EntradaDeParada,
  type FaixaDoAcervo,
} from './emAlta.js';

const entrada = (p: Partial<EntradaDeParada>): EntradaDeParada => ({
  fonte: 'deezer',
  genero: 'Sertanejo',
  posicao: 1,
  titulo: 'Pós (Ao Vivo)',
  artista: 'Felipe e Rodrigo',
  capa: null,
  duracaoMs: 175_000,
  explicito: false,
  origem: 'https://www.deezer.com/track/1',
  ...p,
});

describe('ler as fontes', () => {
  it('Deezer: selo da gravadora vira explícito/limpo/não sei; MC na parada de rap/funk vira Funk', () => {
    const json = {
      data: [
        {
          title: 'A',
          artist: { name: 'MC Ryan SP' },
          explicit_content_lyrics: 1,
          duration: 150,
          position: 1,
          link: 'https://www.deezer.com/track/1',
          album: { cover_medium: 'c1' },
        },
        {
          title: 'B',
          artist: { name: 'Matuê' },
          explicit_content_lyrics: 0,
          duration: 200,
          position: 2,
          link: 'https://www.deezer.com/track/2',
        },
        {
          title: 'C',
          artist: { name: 'Teto' },
          explicit_content_lyrics: 6,
          explicit_lyrics: false,
          position: 3,
        },
        { title: '', artist: { name: 'Vazio' } },
      ],
    };
    const lidas = entradasDoDeezer(472, 'Hip-Hop/Rap', json);
    expect(lidas.map((e) => [e.genero, e.explicito, e.duracaoMs, e.capa])).toEqual([
      ['Funk', true, 150_000, 'c1'],
      ['Hip-Hop/Rap', false, 200_000, null],
      ['Hip-Hop/Rap', null, null, null],
    ]);
    expect(generoDoRapFunk('DJ Boy', 'Set')).toBe('Funk');
    expect(generoDoRapFunk('Djonga', 'Leão')).toBe('Hip-Hop/Rap');
  });

  it('parada 1139 "Funk" da Apple: MC/DJ é Funk, o funk americano vai para R&B/Soul', () => {
    // Top 8 real de 27/10/2026 depois de trocar 1123 por 1139.
    expect(generoDoFunkDaApple('Mc GP, Mc Paiva ZS', 'Menina Viajante')).toBe('Funk');
    expect(generoDoFunkDaApple('DJ BOY & MC Joãozinho VT', 'Pior Versão')).toBe('Funk');
    expect(generoDoFunkDaApple('MC Iguinho da Capital', 'Moto de Vilão')).toBe('Funk');
    expect(generoDoFunkDaApple('James Brown', 'Sex Machine')).toBe('R&B/Soul');
    expect(generoDoFunkDaApple('Rick James', 'Spend The Night With Me')).toBe('R&B/Soul');
    expect(generoDoFunkDaApple('Cause & Effect', 'What Do You See')).toBe('R&B/Soul');
    expect(generoDoFunkDaApple('Benetti House Bar', 'Our Pleasure')).toBe('R&B/Soul');
  });

  it('Apple: a ordem vem do RSS, o selo e a duração do lookup', () => {
    const rss = {
      feed: {
        entry: [
          {
            'im:name': { label: 'Housewife' },
            'im:artist': { label: 'Tate McRae' },
            'im:image': [{ label: 'x/55x55bb.png' }, { label: 'x/170x170bb.png' }],
            id: {
              label: 'https://music.apple.com/br/album/h/1?i=10',
              attributes: { 'im:id': '10' },
            },
          },
          {
            'im:name': { label: 'Sem lookup' },
            'im:artist': { label: 'Alguém' },
            id: { attributes: { 'im:id': '11' } },
          },
        ],
      },
    };
    expect(idsDoRssDaApple(rss)).toEqual(['10', '11']);
    const lookup = new Map([
      [
        '10',
        {
          trackId: 10,
          trackName: 'Housewife',
          artistName: 'Tate McRae',
          trackExplicitness: 'explicit',
          trackTimeMillis: 208_810,
          artworkUrl100: 'y/100x100bb.jpg',
          trackViewUrl: 'https://music.apple.com/br/album/h/1?i=10',
        },
      ],
    ]);
    const lidas = entradasDaApple('Pop', rss, lookup);
    expect(lidas[0]).toMatchObject({
      posicao: 1,
      explicito: true,
      duracaoMs: 208_810,
      capa: 'y/600x600bb.jpg',
      origem: 'https://music.apple.com/br/album/h/1?i=10',
    });
    expect(lidas[1]).toMatchObject({ posicao: 2, explicito: null, duracaoMs: null, origem: null });
  });

  it('YouTube: o nome do vídeo vira artista e título; versão mexida fica de fora', () => {
    const lidas = entradasDoYoutube([
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        title: 'Matuê - Mantém (Clipe Oficial)',
        duracaoSeg: 200,
      },
      {
        url: 'https://www.youtube.com/watch?v=lmnopqrstuv',
        title: 'Matuê - Mantém (speed up)',
        duracaoSeg: 190,
      },
    ]);
    expect(lidas).toHaveLength(1);
    expect(lidas[0]).toMatchObject({
      fonte: 'youtube',
      genero: null,
      artista: 'Matuê',
      titulo: 'Mantém',
      capa: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      origem: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
  });
});

describe('fundir', () => {
  it('a mesma música em duas fontes é UMA, com nota maior e as duas origens', () => {
    const generos = fundirParadas(
      [
        entrada({
          fonte: 'youtube',
          genero: null,
          posicao: 3,
          titulo: 'Pós',
          origem: 'https://www.youtube.com/watch?v=abcdefghijk',
          capa: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
        }),
        entrada({ fonte: 'deezer', posicao: 1, capa: 'https://cdn-images.dzcdn.net/disco.jpg' }),
        entrada({
          fonte: 'apple',
          posicao: 1,
          titulo: 'Outra',
          artista: 'Alguém',
          genero: 'Pop',
          origem: null,
        }),
      ],
      [],
    );
    const todos = generos[0]!;
    expect(todos.genero).toBe('Todos');
    expect(todos.faixas.map((f) => f.titulo)).toEqual(['Pós (Ao Vivo)', 'Outra']);
    const pos = todos.faixas[0]!;
    expect(pos.fontes.sort()).toEqual(['deezer', 'youtube']);
    expect(pos.nota).toBeGreaterThan(todos.faixas[1]!.nota);
    expect(pos.origem).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    // A capa do disco vence o quadro do vídeo, mesmo chegando depois.
    expect(pos.capa).toBe('https://cdn-images.dzcdn.net/disco.jpg');
    expect(pos.genero).toBe('Sertanejo');
    expect(pos.posicao).toBe(1);
    expect(generos.find((g) => g.genero === 'Sertanejo')?.faixas).toHaveLength(1);
  });

  it('o veredito do acervo vence o selo; o título com palavrão condena; fontes limpas absolvem', () => {
    const acervo: FaixaDoAcervo[] = [
      {
        id: 'local:1',
        titulo: 'Pós (Ao Vivo)',
        artista: 'Felipe e Rodrigo',
        genero: 'Sertanejo',
        veredicto: 'explicito',
        tocavel: true,
      },
    ];
    const generos = fundirParadas(
      [
        entrada({ explicito: false }),
        entrada({ titulo: 'Puta que pariu', artista: 'X', explicito: false, genero: 'Funk' }),
        entrada({ titulo: 'Limpa', artista: 'Y', explicito: false, genero: 'Pop' }),
        entrada({ titulo: 'Ninguém sabe', artista: 'Z', explicito: null, genero: 'Pop' }),
      ],
      acervo,
    );
    const por = new Map(generos[0]!.faixas.map((f) => [f.titulo, f]));
    expect(por.get('Pós (Ao Vivo)')).toMatchObject({ conteudo: 'explicito', acervoId: 'local:1' });
    expect(por.get('Puta que pariu')?.conteudo).toBe('explicito');
    expect(por.get('Limpa')?.conteudo).toBe('limpo');
    expect(por.get('Ninguém sabe')?.conteudo).toBe('desconhecido');
    expect(conteudoDasFontes([null, true, false])).toBe('explicito');
    expect(conteudoDasFontes([null, null])).toBe('desconhecido');
  });

  it('sem voto de parada, o gênero vem do artista no acervo; faixa do acervo que não toca não é "do acervo"', () => {
    const acervo: FaixaDoAcervo[] = [
      {
        id: 'local:a',
        titulo: 'Outra do Matuê',
        artista: 'Matuê',
        genero: 'Trap',
        veredicto: null,
        tocavel: true,
      },
      {
        id: 'local:b',
        titulo: 'Mantém',
        artista: 'Matuê',
        genero: 'Trap',
        veredicto: 'limpo',
        tocavel: false,
      },
    ];
    const generos = fundirParadas(
      [
        entrada({
          fonte: 'youtube',
          genero: null,
          titulo: 'Mantém',
          artista: 'Matuê',
          explicito: null,
        }),
      ],
      acervo,
    );
    const f = generos[0]!.faixas[0]!;
    expect(f.genero).toBe('Trap');
    expect(f.conteudo).toBe('limpo');
    expect(f.acervoId).toBeNull();
    expect(generos.some((g) => g.genero === 'Trap')).toBe(true);
  });

  it('respeita o teto por gênero e numera de 1', () => {
    const muitas = Array.from({ length: 12 }, (_, i) =>
      entrada({ titulo: `M${i}`, artista: `A${i}`, posicao: i + 1 }),
    );
    const generos = fundirParadas(muitas, [], { porGenero: 5 });
    expect(generos[0]!.faixas).toHaveLength(5);
    expect(generos[0]!.faixas.map((f) => f.posicao)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a chave ignora acento, caixa e parênteses', () => {
    expect(chaveDaMusica('Felipe e Rodrigo', 'Pós (Ao Vivo)')).toBe(
      chaveDaMusica('FELIPE E RODRIGO', 'pos'),
    );
  });
});
