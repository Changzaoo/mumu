/**
 * QUATRO MIL FAIXAS NÃO CABEM NO localStorage — e o que não cabe some calado.
 *
 * Medido na base de produção: 1352 bytes por faixa.
 *
 *     2.588 faixas → 3,4 MB      4.000 faixas → 5,4 MB      limite ≈ 5 MB
 *
 * Passando disso, `setItem` estoura e falha POR INTEIRO — não grava "o que
 * coube". A biblioteca segue perfeita na tela durante a sessão e volta truncada
 * na recarga, sem aviso. E some justamente onde ninguém olha: nas faixas
 * adicionadas por último.
 *
 * O registro passou para o IndexedDB. Estes testes travam as duas coisas que,
 * se quebrarem, causam exatamente o estrago que a mudança veio evitar.
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
  subscribeCatalogo: () => () => undefined,
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));

function entrada(id: string): LibraryEntry {
  return {
    track: makeTrack(id),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
  };
}

async function montar(): Promise<typeof LocalLibrary> {
  vi.resetModules();
  return import('@/lib/local/localLibrary');
}

/**
 * O cofre do IndexedDB sobrevive ao `resetModules` — cada teste começa limpo.
 *
 * Esvazia a store em vez de apagar o banco: o módulo do teste anterior ainda
 * segura a conexão aberta, e `deleteDatabase` fica bloqueado esperando por ela.
 */
function zerarDisco(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open('aurial-registro', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('biblioteca')) db.createObjectStore('biblioteca');
    };
    req.onsuccess = () => {
      const db = req.result;
      const encerrar = (): void => {
        db.close();
        resolve();
      };
      try {
        const tx = db.transaction('biblioteca', 'readwrite');
        tx.objectStore('biblioteca').clear();
        tx.oncomplete = encerrar;
        tx.onerror = encerrar;
        tx.onabort = encerrar;
      } catch {
        encerrar();
      }
    };
    req.onerror = () => resolve();
  });
}

describe('o registro grande não pode se perder', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await zerarDisco();
  });

  it('uma biblioteca de 4 mil faixas sobrevive à recarga', async () => {
    // É o tamanho em que o `setItem` estourava: 4.000 × 1352 bytes ≈ 5,4 MB.
    const grande = Array.from({ length: 4000 }, (_, i) => entrada(`local:${i}`));
    window.localStorage.setItem('aurial:library', JSON.stringify(grande));

    const primeira = await montar();
    await primeira.hydrate();
    expect(primeira.list()).toHaveLength(4000);
    // A chave gigante sai do caminho: ~5 MB devolvidos ao resto do app.
    expect(window.localStorage.getItem('aurial:library')).toBeNull();

    // RECARGA: sem localStorage nenhum, a biblioteca tem que vir do disco.
    const depois = await montar();
    await depois.hydrate();
    expect(depois.list()).toHaveLength(4000);
  });

  it('a biblioteca do localStorage é adotada, não descartada', async () => {
    // Migração: quem já tinha biblioteca antes da mudança não pode perdê-la.
    const antiga = [entrada('local:a'), entrada('local:b')];
    window.localStorage.setItem('aurial:library', JSON.stringify(antiga));

    const lib = await montar();
    await lib.hydrate();

    expect(
      lib
        .list()
        .map((e) => e.track.id)
        .sort(),
    ).toEqual(['local:a', 'local:b']);
  });

  it('o que chegou ANTES da hidratação não é atropelado pelo disco', async () => {
    // O acervo aplica e a curadoria remenda antes de o registro carregar. Se a
    // hidratação SUBSTITUÍSSE o array em vez de fundir, essas faixas sumiriam.
    window.localStorage.setItem('aurial:library', JSON.stringify([entrada('local:disco')]));
    const lib = await montar();

    lib.aplicarCatalogo([{ ...entrada('local:antes'), origem: undefined } as LibraryEntry]);
    await lib.hydrate();

    const ids = lib.list().map((e) => e.track.id);
    expect(ids).toContain('local:antes');
    expect(ids).toContain('local:disco');
  });
});
