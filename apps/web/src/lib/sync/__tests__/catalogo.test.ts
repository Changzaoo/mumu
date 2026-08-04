/**
 * O acervo é o ÍNDICE; quem serve a música é o servidor Linux.
 *
 * Uma entrada só vale se apontar para lá: `remoteUrl` (a cópia no cofre) ou
 * `sourceUrl` (o link, que o importador transmite ao vivo). Sem rota para o
 * áudio, a faixa aparece na tela de todo mundo e não toca para ninguém — o
 * pior estado possível, porque parece que chegou.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

const setDoc = vi.fn(() => Promise.resolve());

// A conta do teste está na allow-list de admin (lib/auth/roles.ts).
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { email: 'perdibitcoin@gmail.com' } },
  db: {},
  authDisabled: false,
  firebaseReady: () => Promise.resolve(),
  subscribeAuth: () => () => undefined,
  getIdToken: () => Promise.resolve(null),
}));
vi.mock('@/lib/sync/firestoreLazy', () => ({
  firestore: () =>
    Promise.resolve({
      doc: (_db: unknown, _c: string, id: string) => id,
      setDoc,
      deleteDoc: vi.fn(),
    }),
}));

function entrada(extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: makeTrack('local:a'),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
    ...extra,
  };
}

/** O publicar é fire-and-forget: deixa as promises internas resolverem. */
const assentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('publicar no acervo do app', () => {
  let catalogo: typeof import('@/lib/sync/catalogo');

  beforeEach(async () => {
    setDoc.mockClear();
    vi.resetModules();
    catalogo = await import('@/lib/sync/catalogo');
  });

  it('faixa com cópia no cofre entra', async () => {
    catalogo.publicarNoCatalogo(entrada({ remoteUrl: 'https://cofre/a.mp3' }));
    await assentar();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('faixa só com link de origem entra — o importador transmite ao vivo', async () => {
    catalogo.publicarNoCatalogo(entrada({ sourceUrl: 'https://youtube.com/watch?v=x' }));
    await assentar();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('faixa SEM rota para o áudio não entra — não pode aparecer e não tocar', async () => {
    catalogo.publicarNoCatalogo(entrada());
    await assentar();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('a migração do acervo antigo respeita a mesma regra', async () => {
    const publicadas = await catalogo.publicarAcervoDoAdmin([
      entrada({ remoteUrl: 'https://cofre/a.mp3' }),
      entrada(), // sem rota: fica de fora
    ]);
    expect(publicadas).toBe(1);
  });
});
