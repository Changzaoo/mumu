/**
 * A VARREDURA DE ENVIO NÃO PODE PARAR NA PRIMEIRA FAIXA RUIM.
 *
 * Medido em produção: o cofre de blobs voltou depois de 30h fora, e a varredura
 * subiu 23 faixas, parou; na sessão seguinte subiu mais 21 e parou de novo.
 * Sempre algumas dezenas, sempre "sozinha". Quem tem 263 faixas sem cópia no
 * servidor nunca chegava ao fim — e faixa sem cópia é faixa que só toca no
 * aparelho que a importou, e que precisa ser extraída do YouTube A CADA
 * reprodução (foi o que estrangulou nosso IP).
 *
 * Duas travas aqui, e cada uma cobre um jeito diferente de a varredura morrer:
 *   1. um erro numa faixa não derruba as seguintes;
 *   2. a lista de pendentes é tirada UMA vez — iterar o array vivo do cache,
 *      que cada envio substitui, fazia a varredura pular faixas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibrary from '@/lib/local/localLibrary';

const uploadTrackBlob = vi.fn<(id: string, blob: Blob) => Promise<string | null>>();

vi.mock('@/lib/local/importerHelper', () => ({
  uploadTrackBlob: (id: string, blob: Blob) => uploadTrackBlob(id, blob),
  buildStreamUrl: vi.fn(async () => null),
  deleteTrackBlob: vi.fn(),
  fetchArtistCatalog: vi.fn(async () => []),
  fetchCover: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => null),
  fetchPlaylistEntries: vi.fn(async () => ({ title: '', entries: [] })),
  fetchTrackMeta: vi.fn(async () => null),
  helperSupportsMetaTeam: vi.fn(async () => false),
  importerHostLabel: vi.fn(() => null),
  importViaHelper: vi.fn(),
}));

// Sem Cache Storage o áudio vem do IndexedDB — é o caminho do celular, e é o
// que faz `blobFor` devolver bytes para a varredura ter o que enviar.
vi.mock('@/lib/offline/audioCache', () => ({
  cacheStorageSupported: () => false,
  getAudioBlob: vi.fn(async (id: string) =>
    id.startsWith('local:sem-audio') ? null : new Blob(['audio'], { type: 'audio/mpeg' }),
  ),
  hasAudio: vi.fn(async () => true),
  putAudio: vi.fn(),
  deleteAudio: vi.fn(),
  getCoverBlob: vi.fn(async () => null),
  putCover: vi.fn(),
  deleteCover: vi.fn(),
}));

vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
  subscribeCatalogo: () => () => undefined,
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));

function entrada(id: string, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: makeTrack(id),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
    ...over,
  };
}

async function montar(entradas: LibraryEntry[]): Promise<typeof LocalLibrary> {
  vi.resetModules();
  window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
  // SEM hydrate(): ele dispara a curadoria de fundo inteira (catálogo, capas,
  // auditoria por IA), que nunca assenta e pendura o teste. `read()` lê o
  // localStorage sozinho — é tudo de que a varredura precisa.
  return await import('@/lib/local/localLibrary');
}

describe('a varredura de envio não desiste no meio', () => {
  beforeEach(() => {
    window.localStorage.clear();
    uploadTrackBlob.mockReset();
    uploadTrackBlob.mockImplementation(async (id) => `https://cofre/${id}`);
  });

  it('uma faixa que EXPLODE não impede as seguintes de subir', async () => {
    const lib = await montar([entrada('local:a'), entrada('local:b'), entrada('local:c')]);

    uploadTrackBlob.mockImplementation(async (id) => {
      if (id === 'local:b') throw new Error('cofre piscou');
      return `https://cofre/${id}`;
    });

    await lib.backfillRemote();

    const tentadas = uploadTrackBlob.mock.calls.map(([id]) => id);
    expect(tentadas).toContain('local:a');
    expect(tentadas).toContain('local:b');
    // A prova: 'c' vem DEPOIS do erro em 'b'. Sem a trava, nunca era tentada.
    expect(tentadas).toContain('local:c');
  });

  it('envia TODAS as pendentes — não só as primeiras', async () => {
    // Trinta faixas: o suficiente para a lista se remontar várias vezes durante
    // a varredura, que era o que a fazia pular itens.
    const muitas = Array.from({ length: 30 }, (_, i) => entrada(`local:${i}`));
    const lib = await montar(muitas);

    await lib.backfillRemote();

    expect(uploadTrackBlob).toHaveBeenCalledTimes(30);
    expect(new Set(uploadTrackBlob.mock.calls.map(([id]) => id)).size).toBe(30);
  });

  it('pula quem já tem cópia e quem não tem áudio neste aparelho', async () => {
    const lib = await montar([
      entrada('local:ja-tem', { remoteUrl: 'https://cofre/antiga' }),
      entrada('local:sem-audio-1'),
      entrada('local:normal'),
    ]);

    await lib.backfillRemote();

    const tentadas = uploadTrackBlob.mock.calls.map(([id]) => id);
    expect(tentadas).toEqual(['local:normal']);
  });

  it('grava o remoteUrl de quem subiu', async () => {
    const lib = await montar([entrada('local:x')]);

    await lib.backfillRemote();

    expect(lib.remoteUrlFor('local:x')).toBe('https://cofre/local:x');
  });
});
