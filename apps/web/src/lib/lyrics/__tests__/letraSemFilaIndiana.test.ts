/**
 * A LETRA NÃO PODE CHEGAR EM FILA INDIANA.
 *
 * `lrclibGet` monta uma lista de candidatos (título limpo × título cru ×
 * artistas × sem artista) e pergunta ao LRCLIB por cada um. Isso estava escrito
 * como `await` dentro de `for` dentro de `for`: até seis viagens de rede uma
 * ESPERANDO A OUTRA na consulta exata, e mais seis na busca solta. Doze idas em
 * série, a ~400ms cada num celular, é a letra levando vários segundos para
 * aparecer numa faixa que o servidor respondeu de primeira.
 *
 * Duas coisas são travadas aqui, e a segunda é a que impede o conserto de virar
 * um defeito novo:
 *
 *   1. os candidatos são perguntados JUNTOS;
 *   2. a ESCOLHA continua obedecendo à ordem de preferência, não à ordem de
 *      chegada. Deixar a rede escolher a letra é exatamente como letra de outra
 *      música se instala — e este arquivo tem um irmão (`letraCerta.test.ts`)
 *      que existe por causa disso.
 *
 * E a terceira: uma faixa SEM letra não pode refazer a busca inteira toda vez
 * que tocar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/ai/ai', () => ({
  aiCleanSongTitle: vi.fn().mockResolvedValue(null),
}));

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 'local:t1',
    title: 'Warzone (Remix)',
    durationMs: 166_000,
    artists: [
      { id: 'a1', name: 'Brandão85', slug: 'brandao85', imageUrl: null },
      { id: 'a2', name: 'Xamã', slug: 'xama', imageUrl: null },
    ],
    album: { id: 'al1', title: 'Álbum', slug: 'album', coverUrl: null },
    ...over,
  }) as TrackDto;

/** Uma resposta do /api/get do LRCLIB que bate com a faixa acima. */
const linhaSincronizada = (marca: string) => ({
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  syncedLyrics: `[00:01.00]${marca}`,
});

interface Chamada {
  url: string;
  responder: (corpo: unknown) => void;
}

describe('a busca de letra pergunta a todos os candidatos de uma vez', () => {
  let pendentes: Chamada[];
  let emVoo: number;
  let picoEmVoo: number;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    pendentes = [];
    emVoo = 0;
    picoEmVoo = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        emVoo += 1;
        picoEmVoo = Math.max(picoEmVoo, emVoo);
        return new Promise((resolve) => {
          pendentes.push({
            url: String(url),
            responder: (corpo) => {
              emVoo -= 1;
              resolve({ ok: true, json: () => Promise.resolve(corpo) } as Response);
            },
          });
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('as consultas exatas saem JUNTAS, não uma esperando a outra', async () => {
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');
    const promessa = fetchLyrics(faixa());

    // Um microtask basta para todos os `fetch` da rodada exata terem saído: se
    // ainda fossem sequenciais, só UM teria sido disparado.
    await vi.waitFor(() => expect(pendentes.length).toBeGreaterThan(1));
    expect(picoEmVoo).toBeGreaterThan(1);

    for (const p of [...pendentes]) p.responder(linhaSincronizada('a'));
    await promessa;
  });

  it('a escolha segue a ORDEM DE PREFERÊNCIA, não a ordem de chegada', async () => {
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');
    const promessa = fetchLyrics(faixa());
    await vi.waitFor(() => expect(pendentes.length).toBeGreaterThan(1));

    // O ÚLTIMO candidato responde PRIMEIRO — e mesmo assim não pode vencer: o
    // primeiro da lista é o mais confiável (título limpo + artista principal).
    const rodada = [...pendentes];
    const ultimo = rodada[rodada.length - 1];
    const primeiro = rodada[0];
    ultimo?.responder(linhaSincronizada('candidato-fraco'));
    primeiro?.responder(linhaSincronizada('candidato-forte'));
    for (const p of rodada.slice(1, -1)) p.responder(null);

    const letra = await promessa;
    expect(letra?.lines[0]?.text).toBe('candidato-forte');
  });

  it('faixa sem letra não refaz a busca inteira na próxima vez que tocar', async () => {
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');
    const alvo = faixa();

    /** Responde tudo que está em voo AGORA e tira da lista, para a rodada
     *  seguinte poder ser esperada sem confundir com esta. */
    const responderRodada = async (corpo: unknown): Promise<void> => {
      await vi.waitFor(() => expect(pendentes.length).toBeGreaterThan(0));
      for (const p of pendentes.splice(0, pendentes.length)) p.responder(corpo);
    };

    const primeira = fetchLyrics(alvo);
    await responderRodada(null); // consulta exata: nada
    await responderRodada([]); // busca solta: nada
    expect(await primeira).toBeNull();

    const gastas = vi.mocked(fetch).mock.calls.length;
    expect(gastas).toBeGreaterThan(1); // a primeira busca realmente foi à rede

    // A segunda reprodução da MESMA faixa não pode gastar rede nenhuma.
    expect(await fetchLyrics(alvo)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(gastas);
  });
});
