/**
 * UMA BUSCA POR FAIXA DE CADA VEZ. A pré-busca do player (ao entrar na fila) e
 * a consulta da tela da letra pedem a mesma faixa no mesmo instante: tem de
 * ser UMA ida ao LRCLIB, com os dois pedidos recebendo a mesma resposta. Faixa
 * diferente (ou a mesma com metadado corrigido) é outra busca.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/ai/ai', () => ({ aiCleanSongTitle: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/local/importerHelper', () => ({
  fetchOutraFonteDeLetra: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({ registrarLetra: vi.fn() }));

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 'local:t1',
    title: 'Warzone',
    durationMs: 166_000,
    previewOnly: false,
    artists: [{ id: 'a1', name: 'Brandão85', slug: 'brandao85', imageUrl: null }],
    album: { id: 'al1', title: 'Álbum', slug: 'album', coverUrl: null },
    ...over,
  }) as TrackDto;

const linha = (nome: string) => ({
  trackName: nome,
  artistName: 'Brandão85',
  duration: 166,
  syncedLyrics: `[00:01.00]letra de ${nome}`,
});

/** O LRCLIB responde só quando `soltar()` é chamado — a busca fica em voo. */
function fonteSegurada() {
  const pendentes: Array<() => void> = [];
  let aberta = false; // depois de `soltar()`, tudo responde na hora
  const f = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve) => {
        const u = new URL(url);
        const nome = u.searchParams.get('track_name') ?? 'x';
        const responder = (): void =>
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(u.pathname.endsWith('/api/get') ? linha(nome) : [linha(nome)]),
          } as Response);
        if (aberta) responder();
        else pendentes.push(responder);
      }),
  );
  return {
    f,
    soltar: () => {
      aberta = true;
      pendentes.splice(0).forEach((r) => r());
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('busca de letra em voo', () => {
  it('dois pedidos da mesma faixa ao mesmo tempo = uma ida ao LRCLIB, a mesma resposta', async () => {
    const { f, soltar } = fonteSegurada();
    vi.stubGlobal('fetch', f);
    const { fetchLyrics, prefetchLyrics } = await import('@/lib/lyrics/lyrics');

    prefetchLyrics(faixa()); // o player, ao entrar na fila
    const daTela = fetchLyrics(faixa()); // a tela da letra, logo em seguida
    expect(f).toHaveBeenCalledTimes(1);

    soltar();
    const letra = await daTela;
    expect(letra?.lines[0]?.text).toBe('letra de Warzone');
    // Terminada, a próxima consulta vem do cache — e não abre busca nova.
    expect(await fetchLyrics(faixa())).toEqual(letra);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('faixa diferente, ou a mesma com metadado corrigido, é outra busca', async () => {
    const { f, soltar } = fonteSegurada();
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const a = fetchLyrics(faixa());
    const b = fetchLyrics(faixa({ id: 'local:t2', title: 'Outra' }));
    // Mesmo id, artista corrigido na curadoria: outro fingerprint, outra busca.
    const c = fetchLyrics(
      faixa({ artists: [{ id: 'a2', name: 'Brandão', slug: 'brandao', imageUrl: null }] }),
    );
    expect(f).toHaveBeenCalledTimes(3);
    expect(new Set(f.mock.calls.map((c) => c[0])).size).toBe(3);
    soltar();
    const [la, lb] = await Promise.all([a, b, c]);
    expect(la?.lines[0]?.text).toBe('letra de Warzone');
    expect(lb?.lines[0]?.text).toBe('letra de Outra');
  });
});
