/**
 * A MESMA MÚSICA NÃO ENTRA DUAS VEZES — nem com outro nome (ver duplicadas.ts).
 *
 * O que estes testes travam nos dois sentidos: ruído de YouTube/serviço não
 * separa a mesma música ("(Official Video)", "ft." × "feat.", remaster, link
 * com `&list=`), e versão de verdade (ao vivo, sped up, remix, acústico) NUNCA
 * vira duplicata da original — a limpeza apaga, e falso positivo é música
 * perdida.
 */
import { describe, expect, it } from 'vitest';
import {
  acharMesmaMusica,
  artistaPrincipal,
  chaveDaMusica,
  chaveDaOrigem,
  comVersoesDe,
  paresPelaLetra,
  semelhancaDeLetra,
  separarRepetidas,
  tituloCanonico,
  versoesDoTitulo,
  type EntradaIndexavel,
} from '@/lib/local/duplicadas';

const entrada = (
  id: string,
  title: string,
  artist: string,
  durationMs = 0,
  sourceUrl?: string,
): EntradaIndexavel => ({
  track: { id, title, durationMs, artists: artist ? [{ name: artist }] : [] },
  ...(sourceUrl ? { sourceUrl } : {}),
});

describe('título canônico', () => {
  it('"Música (Official Video)" é "Música"', () => {
    expect(tituloCanonico('Música (Official Video)')).toBe(tituloCanonico('Música'));
    expect(tituloCanonico('Música [Clipe Oficial]')).toBe('musica');
    expect(tituloCanonico('Música (Áudio Oficial)')).toBe('musica');
    expect(tituloCanonico('Música (Lyric Video)')).toBe('musica');
    expect(tituloCanonico('Música - Official Music Video')).toBe('musica');
    expect(tituloCanonico('Música (Visualizer) | Canal Tal')).toBe('musica');
    expect(tituloCanonico('Música #shorts')).toBe('musica');
  });

  it('"feat." e "ft." (com ou sem parênteses) somem', () => {
    const base = tituloCanonico('TUDO BEM');
    expect(tituloCanonico('TUDO BEM FT. BNYX')).toBe(base);
    expect(tituloCanonico('Tudo Bem (feat. BNYX)')).toBe(base);
    expect(tituloCanonico('Tudo Bem ft BNYX')).toBe(base);
    expect(tituloCanonico('Tudo Bem (Prod. by X) [Official Video]')).toBe(base);
  });

  it('remaster é a mesma gravação', () => {
    expect(tituloCanonico('Something (Remastered 2009)')).toBe('something');
    expect(tituloCanonico('Something - 2009 Remaster')).toBe('something');
    expect(versoesDoTitulo('Something (Remastered 2009)')).toEqual([]);
  });

  it('não confunde nome de música com participação', () => {
    expect(tituloCanonico('Part of Me')).toBe('part of me');
    expect(tituloCanonico('Live Forever')).toBe('live forever');
    expect(versoesDoTitulo('Live Forever')).toEqual([]);
  });

  it('parêntese que não é ruído nem versão continua no nome', () => {
    expect(tituloCanonico('Sozinho (Parte 2)')).toBe('sozinho parte 2');
  });

  it('funciona em qualquer alfabeto', () => {
    expect(tituloCanonico('소리꾼 (Official Video)')).toBe('소리꾼');
  });
});

describe('versões de verdade NÃO são a mesma música', () => {
  const chave = (t: string): string | null => chaveDaMusica(t, 'Matuê');

  it('"Ao Vivo" não é a mesma', () => {
    expect(chave('Música (Ao Vivo)')).not.toBe(chave('Música'));
    expect(chave('Música - Ao Vivo')).toBe(chave('Música (Ao Vivo)'));
    expect(chave('Música (Live)')).toBe(chave('Música (Ao Vivo)'));
    expect(chave('Música Ao Vivo')).toBe(chave('Música (Ao Vivo)'));
  });

  it('sped up / slowed / nightcore não são a mesma', () => {
    expect(chave('Música (Sped Up)')).not.toBe(chave('Música'));
    expect(chave('Música - sped up')).toBe(chave('Música (Sped Up)'));
    expect(chave('Música (Nightcore)')).toBe(chave('Música (Sped Up)'));
    expect(chave('Música (Slowed + Reverb)')).not.toBe(chave('Música'));
    expect(chave('Música (Slowed + Reverb)')).not.toBe(chave('Música (Sped Up)'));
  });

  it('remix, acústico, instrumental e cover não são a mesma', () => {
    for (const v of ['(Remix)', '(Acústico)', '(Instrumental)', '(Cover)', '(Versão Piseiro)']) {
      expect(chave(`Música ${v}`)).not.toBe(chave('Música'));
    }
    expect(chave('Música (Acoustic Version)')).toBe(chave('Música (Acústico)'));
  });

  it('o ruído junto da versão não separa: "(Ao Vivo) [Official Video]" = "(Ao Vivo)"', () => {
    expect(chave('Música (Ao Vivo) [Official Video]')).toBe(chave('Música (Ao Vivo)'));
  });
});

describe('artista principal', () => {
  it('pega o primeiro nome e ignora Topic/VEVO/feat', () => {
    expect(artistaPrincipal('Matuê, Teto & WIU')).toBe('matue');
    expect(artistaPrincipal('Anitta - Topic')).toBe('anitta');
    expect(artistaPrincipal('Chitãozinho & Xororó')).toBe(artistaPrincipal('Chitaozinho e Xororo'));
    expect(artistaPrincipal('E-40')).toBe('e 40');
  });

  it('desconhecido não é artista: sem chave, ninguém deduplica', () => {
    expect(artistaPrincipal('Desconhecido')).toBe('');
    expect(chaveDaMusica('Música', 'Desconhecido')).toBeNull();
  });

  it('artista diferente é outra música (cover)', () => {
    expect(chaveDaMusica('Evidências', 'Chitãozinho & Xororó')).not.toBe(
      chaveDaMusica('Evidências', 'Lauana Prado'),
    );
  });
});

describe('origem', () => {
  it('o mesmo vídeo em links diferentes tem a mesma origem', () => {
    const id = 'yt:dQw4w9WgXcQ';
    expect(chaveDaOrigem('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe(id);
    expect(chaveDaOrigem('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&index=3')).toBe(id);
    expect(chaveDaOrigem('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(id);
    expect(chaveDaOrigem('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe(id);
  });

  it('serviços viram o id da faixa', () => {
    expect(chaveDaOrigem('https://open.spotify.com/intl-pt/track/abc123?si=x')).toBe(
      'spotify:abc123',
    );
    expect(chaveDaOrigem('https://www.deezer.com/br/track/42')).toBe('deezer:42');
    expect(chaveDaOrigem('https://music.apple.com/br/album/x/1?i=99')).toBe('apple:99');
  });

  it('link inválido não tem origem', () => {
    expect(chaveDaOrigem('não é link')).toBeNull();
  });
});

describe('antes de baixar', () => {
  const biblioteca = [
    entrada('local:1', '333', 'Matuê', 322_000, 'https://www.youtube.com/watch?v=AAAAAAAAAAA'),
    entrada('local:2', 'Música', 'Alee', 0),
  ];

  it('acha pela origem, mesmo com link diferente', () => {
    expect(
      acharMesmaMusica(biblioteca, { url: 'https://youtu.be/AAAAAAAAAAA', titulo: '' })?.track.id,
    ).toBe('local:1');
  });

  it('acha pela chave com "Artista - Título (ruído)", nas duas ordens', () => {
    expect(acharMesmaMusica(biblioteca, { titulo: 'Matuê - 333 (Áudio Oficial)' })?.track.id).toBe(
      'local:1',
    );
    expect(acharMesmaMusica(biblioteca, { titulo: '333 - Matuê' })?.track.id).toBe('local:1');
  });

  it('duração: ±3 s casa; longe não; desconhecida deixa a chave decidir', () => {
    const p = { titulo: 'Matuê - 333' };
    expect(acharMesmaMusica(biblioteca, { ...p, durationMs: 324_000 })).not.toBeNull();
    expect(acharMesmaMusica(biblioteca, { ...p, durationMs: 340_000 })).toBeNull();
    expect(
      acharMesmaMusica(biblioteca, { titulo: 'Alee - Música', durationMs: 200_000 }),
    ).not.toBeNull();
  });

  it('versão diferente não é "já na biblioteca"', () => {
    expect(acharMesmaMusica(biblioteca, { titulo: 'Matuê - 333 (Ao Vivo)' })).toBeNull();
    expect(acharMesmaMusica(biblioteca, { titulo: 'Matuê - 333 (Sped Up)' })).toBeNull();
  });

  it('separa o que já está na biblioteca, na fila e repetido na própria lista', () => {
    const { novas, repetidas } = separarRepetidas(
      [
        { url: 'https://youtu.be/AAAAAAAAAAA', title: 'qualquer' },
        {
          url: 'https://youtu.be/BBBBBBBBBBB',
          title: 'Alee - Nova (Official Video)',
          duracaoSeg: 200,
        },
        { url: 'https://youtu.be/CCCCCCCCCCC', title: 'Alee - Nova (Audio)', duracaoSeg: 199 },
        { url: 'https://youtu.be/DDDDDDDDDDD', title: 'Alee - Outra' },
        { url: 'https://youtu.be/EEEEEEEEEEE', title: 'Alee - Nova (Ao Vivo)', duracaoSeg: 260 },
      ],
      biblioteca,
      [{ url: 'https://www.youtube.com/watch?v=DDDDDDDDDDD&list=X' }],
    );
    expect(novas.map((n) => n.url.slice(-11))).toEqual(['BBBBBBBBBBB', 'EEEEEEEEEEE']);
    expect(repetidas.map((r) => [r.url.slice(-11), r.motivo])).toEqual([
      ['AAAAAAAAAAA', 'biblioteca'],
      ['CCCCCCCCCCC', 'fila'],
      ['DDDDDDDDDDD', 'fila'],
    ]);
  });
});

describe('o crédito não perde a versão', () => {
  it('devolve a marca que a limpeza tirou', () => {
    expect(comVersoesDe('Evidências', 'Evidências (Ao Vivo) [Official Video]')).toBe(
      'Evidências (Ao Vivo)',
    );
    expect(comVersoesDe('Música', 'Artista - Música (Sped Up)')).toBe('Música (Sped Up)');
  });

  it('não duplica nem inventa', () => {
    expect(comVersoesDe('Música (Ao Vivo)', 'Música (Ao Vivo)')).toBe('Música (Ao Vivo)');
    expect(comVersoesDe('Música', 'Música (Official Video)')).toBe('Música');
  });
});

const LETRA = `
[Refrão]
Eu sei que você vai voltar pra mim, eu sei
Mesmo que demore a noite inteira eu espero aqui
O céu de São Paulo não apaga a luz que eu vi
E cada rua dessa cidade lembra de você
Eu sei que você vai voltar pra mim, eu sei
Mesmo que demore a noite inteira eu espero aqui
Não adianta fingir que o tempo apaga o que ficou
`;

describe('comparação pela letra', () => {
  it('letras quase iguais são a mesma (transcrição com uma palavra trocada)', () => {
    const quase = LETRA.replace('noite inteira', 'noite inteiro').replace('[Refrão]', '');
    expect(semelhancaDeLetra(LETRA, quase)).toBeGreaterThanOrEqual(0.8);
  });

  it('letras diferentes não são', () => {
    const outra = `Hoje eu acordei com vontade de dançar no meio da rua sem ninguém
      olhando pra mim, a batida alta e o coração na mão, vou até o fim da
      madrugada e ninguém vai me parar, porque hoje a noite é nossa e acabou`;
    expect(semelhancaDeLetra(LETRA, outra)).toBeLessThan(0.3);
  });

  it('letra curta demais não prova nada', () => {
    expect(semelhancaDeLetra('oh oh oh yeah', 'oh oh oh yeah')).toBe(0);
  });

  const c = (id: string, titulo: string, artista: string, seg: number, letra = LETRA) => ({
    id,
    titulo,
    artistas: [artista],
    durationMs: seg * 1000,
    letra,
  });

  it('outro nome, mesma letra, mesmo artista, duração próxima → par', () => {
    expect(
      paresPelaLetra([c('a', '333', 'Matuê', 322), c('b', 'Três Três Três', 'Matuê', 331)]),
    ).toEqual([['a', 'b']]);
  });

  it('sped up tem a mesma letra e NÃO é par (marca e duração)', () => {
    expect(
      paresPelaLetra([c('a', '333', 'Matuê', 322), c('b', '333 (Sped Up)', 'Matuê', 318)]),
    ).toEqual([]);
    // Mesmo sem a marca no título, a duração ~15% menor separa.
    expect(paresPelaLetra([c('a', '333', 'Matuê', 322), c('b', '333', 'Matuê', 274)])).toEqual([]);
  });

  it('ao vivo tem a mesma letra e NÃO é par', () => {
    expect(
      paresPelaLetra([c('a', '333', 'Matuê', 322), c('b', '333 (Ao Vivo)', 'Matuê', 325)]),
    ).toEqual([]);
  });

  it('cover (outro artista) com a mesma letra NÃO é par', () => {
    expect(paresPelaLetra([c('a', '333', 'Matuê', 322), c('b', '333', 'Outro', 322)])).toEqual([]);
  });
});
