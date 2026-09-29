/**
 * A LIMPEZA DE DUPLICADAS (a que APAGA) de ponta a ponta.
 *
 * Trava o que o pedido "nunca baixe música repetida" exige da biblioteca que
 * já existe: clipe × áudio e "ft." × sem nada viram uma faixa só; o reupload
 * com outro nome é pego pela LETRA; ao vivo e sped up continuam separados; a
 * curtida e o histórico da cópia apagada migram para a que ficou; e tudo pode
 * ser desfeito — e, desfeito, não volta a ser juntado.
 */
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibrary from '@/lib/local/localLibrary';

vi.mock('@/lib/local/importerHelper', () => ({
  uploadTrackBlob: vi.fn(async () => null),
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
  servicoDeMusicaLabel: vi.fn(() => null),
  ehColecaoDoSpotify: vi.fn(() => false),
  MENSAGEM_CURTIDAS_SPOTIFY: '',
  fetchOutraFonteDeLetra: vi.fn(async () => null),
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

const LETRA = `Eu sei que você vai voltar pra mim, eu sei
Mesmo que demore a noite inteira eu espero aqui
O céu de São Paulo não apaga a luz que eu vi
E cada rua dessa cidade lembra de você
Não adianta fingir que o tempo apaga o que ficou`;

const letras = new Map<string, string>();
vi.mock('@/lib/lyrics/lyrics', () => ({
  lyricsCacheEntries: () =>
    [...letras].map(([id, t]) => [
      id,
      { synced: false, source: null, lines: t.split('\n').map((text) => ({ timeMs: 0, text })) },
    ]),
}));

const MATUE = { id: 'a', name: 'Matuê', slug: 'matue', imageUrl: null };

function faixa(id: string, title: string, segundos: number, dia: number): LibraryEntry {
  return {
    track: makeTrack(id, { title, durationMs: segundos * 1000, artists: [MATUE] }),
    addedAt: `2026-01-${String(dia).padStart(2, '0')}T00:00:00.000Z`,
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
  };
}

async function montar(entradas: LibraryEntry[]): Promise<typeof LocalLibrary> {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
  return await import('@/lib/local/localLibrary');
}

describe('limpeza de duplicadas', () => {
  it('junta ruído e letra, preserva versões, migra curtida/histórico e desfaz', async () => {
    const entradas = [
      faixa('local:A', 'Nova (Official Video)', 200, 1),
      faixa('local:B', 'Nova ft. Teto (Audio)', 201, 2),
      faixa('local:C', '333', 322, 3),
      faixa('local:D', 'Três Três Três', 330, 4), // outro nome, mesma letra
      faixa('local:E', 'Nova (Ao Vivo)', 201, 5),
      faixa('local:F', '333 (Sped Up)', 270, 6),
    ];
    letras.clear();
    for (const id of ['local:C', 'local:D', 'local:F']) letras.set(id, LETRA);

    const lib = await montar(entradas);
    const b = entradas[1]!.track;
    const d = entradas[3]!.track;
    window.localStorage.setItem('aurial:local-likes', JSON.stringify([b.id]));
    window.localStorage.setItem('aurial:local-liked-tracks', JSON.stringify({ [b.id]: b }));
    window.localStorage.setItem(
      'aurial:local-history',
      JSON.stringify([{ id: 'h1', playedAt: '', playedMs: 0, source: 'queue', track: d }]),
    );

    expect(await lib.dedupeLibrary()).toBe(2);
    const ids = lib.list().map((e) => e.track.id);
    expect(ids).toEqual(['local:A', 'local:C', 'local:E', 'local:F']);

    // A curtida e a reprodução das cópias apagadas foram para as que ficaram.
    const likes = await import('@/lib/local/localLikes');
    expect(likes.list().map((t) => t.id)).toEqual(['local:A']);
    const historico = await import('@/lib/local/localHistory');
    expect(historico.list()[0]?.track.id).toBe('local:C');

    // Desfazer traz as duas de volta — e elas não são juntadas de novo.
    expect(lib.duplicadasNaLixeira()).toBe(2);
    expect(await lib.restaurarDuplicadas()).toBe(2);
    expect(lib.list()).toHaveLength(6);
    expect(await lib.dedupeLibrary()).toBe(0);
    expect(lib.duplicadasNaLixeira()).toBe(0);
  });
});
