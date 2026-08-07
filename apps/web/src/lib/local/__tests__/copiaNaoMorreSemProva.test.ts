/**
 * O CONSERTO DO COFRE NÃO PODE SE AUTODESTRUIR EM USO.
 *
 * O cofre passou a se refazer: quando a poda leva os bytes, o importador
 * reextrai a faixa da origem sob o MESMO token. Isso leva ~20s, e para o player
 * é indistinguível de uma URL morta — o elemento <audio> só sabe dizer "não
 * carregou".
 *
 * `reportDeadRemote` apagava a cópia nesse momento. Ou seja: na PRIMEIRA vez
 * que alguém pedisse uma faixa descartada, o app jogaria fora a URL boa, e a
 * faixa nunca mais seria pedida por ela. O conserto do servidor morreria pelas
 * mãos do cliente.
 *
 * Agora só 404/403 — resposta de verdade dizendo "não existe" — descarta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibrary from '@/lib/local/localLibrary';

vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));

const URL_DA_COPIA = 'https://cofre/blob/local%3Aa?k=tok';

/** Entrada do acervo — é assim que a faixa chega ao aparelho do visitante. */
function entrada(id: string): LibraryEntry {
  return {
    track: { ...makeTrack(id), streamUrl: URL_DA_COPIA },
    addedAt: '2026-08-07T00:00:00.000Z',
    remoteUrl: URL_DA_COPIA,
  } as LibraryEntry;
}

async function montar(): Promise<typeof LocalLibrary> {
  vi.resetModules();
  window.localStorage.clear();
  return import('@/lib/local/localLibrary');
}

/** Espera a sondagem assíncrona de `reportDeadRemote` terminar. */
const assentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('reportDeadRemote — só descarta com prova', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('MANTÉM a cópia quando o cofre está reconstruindo (responde 206)', async () => {
    const lib = await montar();
    lib.aplicarCatalogo([entrada('local:a')]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0]), { status: 206 })),
    );

    lib.reportDeadRemote('local:a', URL_DA_COPIA);
    await assentar();

    // Se isto virar null, o conserto do servidor foi desfeito pelo cliente.
    expect(lib.remoteUrlFor('local:a')).toBe(URL_DA_COPIA);
  });

  it('MANTÉM a cópia quando a rede falha (não é prova de morte)', async () => {
    const lib = await montar();
    lib.aplicarCatalogo([entrada('local:b')]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed to fetch');
      }),
    );

    lib.reportDeadRemote('local:b', URL_DA_COPIA);
    await assentar();

    expect(lib.remoteUrlFor('local:b')).toBe(URL_DA_COPIA);
  });

  it('DESCARTA quando o cofre responde 404 — aí sim acabou', async () => {
    const lib = await montar();
    lib.aplicarCatalogo([entrada('local:c')]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    lib.reportDeadRemote('local:c', URL_DA_COPIA);
    await assentar();

    expect(lib.remoteUrlFor('local:c')).toBeNull();
  });

  it('ignora chamada para uma URL que já não é a da faixa', async () => {
    const lib = await montar();
    lib.aplicarCatalogo([entrada('local:d')]);

    const chamou = vi.fn();
    vi.stubGlobal('fetch', chamou);

    lib.reportDeadRemote('local:d', 'https://cofre/blob/outra?k=x');
    await assentar();

    expect(chamou).not.toHaveBeenCalled();
    expect(lib.remoteUrlFor('local:d')).toBe(URL_DA_COPIA);
  });
});
