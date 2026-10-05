/**
 * "É A MESMA MÚSICA?" — títulos quase iguais e biblioteca grande.
 *
 * Dois erros opostos custam caro: juntar o que é DIFERENTE (o remix some, o ao
 * vivo some) e deixar passar o que é IGUAL (a lista cresce com clipe + áudio).
 * E a pergunta roda por faixa de uma playlist de centenas contra uma biblioteca
 * de milhares: se virar varredura linear, importar uma lista trava a aba.
 */
import { describe, expect, it } from 'vitest';
import { acharMesmaMusica, separarRepetidas } from '@/lib/local/duplicadas';

const entrada = (
  id: string,
  title: string,
  artist: string,
  durationMs = 200_000,
  sourceUrl?: string,
) => ({
  track: { id, title, artists: [{ name: artist }], durationMs },
  ...(sourceUrl ? { sourceUrl } : {}),
});

describe('mesma música, títulos quase iguais', () => {
  const biblioteca = [entrada('1', 'Última Vez', 'Alee')];

  it.each([
    ['sufixo de clipe', 'Alee - Última Vez (Official Video)'],
    ['caixa alta e acento', 'ALEE - ULTIMA VEZ'],
    ['ordem invertida', 'ÚLTIMA VEZ - Alee'],
    ['lixo de canal depois do |', 'Alee - Última Vez | Canal Oficial'],
  ])('%s é a mesma', (_n, titulo) => {
    expect(acharMesmaMusica(biblioteca, { titulo, durationMs: 201_000 })?.track.id).toBe('1');
  });

  it.each([
    ['remix', 'Alee - Última Vez (Remix)'],
    ['ao vivo', 'Alee - Última Vez (Ao Vivo)'],
    ['outra faixa do mesmo artista', 'Alee - Primeira Vez'],
  ])('%s NÃO é a mesma', (_n, titulo) => {
    expect(acharMesmaMusica(biblioteca, { titulo, durationMs: 200_000 })).toBeNull();
  });

  it('mesmo título e artista mas duração muito diferente (10 min vs 3 min) não junta', () => {
    expect(
      acharMesmaMusica(biblioteca, { titulo: 'Alee - Última Vez', durationMs: 600_000 }),
    ).toBeNull();
  });

  it('o mesmo vídeo por outro link (youtu.be vs watch?v=&list=) é a mesma origem', () => {
    const lib = [entrada('9', 'Qualquer', 'X', 1000, 'https://youtu.be/dQw4w9WgXcQ')];
    expect(
      acharMesmaMusica(lib, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3',
        titulo: 'título totalmente diferente',
      })?.track.id,
    ).toBe('9');
  });
});

describe('escala: playlist grande contra biblioteca grande', () => {
  it('300 faixas da lista contra 5.000 na biblioteca resolvem em tempo curto (sem varredura linear)', () => {
    const biblioteca = Array.from({ length: 5000 }, (_, i) =>
      entrada(`l${i}`, `Faixa ${i}`, `Artista ${i % 400}`, 180_000 + (i % 50) * 1000),
    );
    const lista = Array.from({ length: 300 }, (_, i) => ({
      url: `https://youtu.be/${String(i).padStart(11, 'a')}`,
      title: `Artista ${(i * 7) % 400} - Faixa ${i * 7}`,
      duracaoSeg: 180 + ((i * 7) % 50),
    }));

    const t0 = performance.now();
    const { novas, repetidas } = separarRepetidas(lista, biblioteca);
    const ms = performance.now() - t0;

    expect(novas.length + repetidas.length).toBe(300);
    expect(repetidas.length).toBeGreaterThan(250); // quase todas já existem
    expect(ms).toBeLessThan(1500);
  });

  it('a mesma música repetida DENTRO da lista (clipe e áudio) entra uma vez só', () => {
    const lista = [
      { url: 'https://youtu.be/aaaaaaaaaaa', title: 'Alee - Última Vez', duracaoSeg: 200 },
      {
        url: 'https://youtu.be/bbbbbbbbbbb',
        title: 'Alee - Última Vez (Official Video)',
        duracaoSeg: 201,
      },
    ];
    const { novas, repetidas } = separarRepetidas(lista, []);
    expect(novas).toHaveLength(1);
    expect(repetidas).toHaveLength(1);
  });
});
