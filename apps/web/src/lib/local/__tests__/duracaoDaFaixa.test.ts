/**
 * TODA FAIXA COM A DURAÇÃO DE VERDADE.
 *
 * Três regras, cada uma tirada de um defeito visto na lista:
 *  - "0:00" que nunca sumia: a duração medida ao tocar uma faixa do ACERVO era
 *    desfeita pelo snapshot seguinte, que ainda dizia `0`;
 *  - "0:14" numa faixa de quatro minutos: a medida real não podia corrigir um
 *    valor já gravado, por pior que fosse;
 *  - e, do outro lado, duração boa não pode ser trocada por arredondamento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibraryModule from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

type LocalLibrary = typeof LocalLibraryModule;

vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

function entrada(id: string, durationMs: number, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: { ...makeTrack(id), durationMs },
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
    ...extra,
  };
}

describe('duração da faixa', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function montar(entradas: LibraryEntry[]): Promise<LocalLibrary> {
    window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
    vi.resetModules();
    return import('@/lib/local/localLibrary');
  }

  const duracao = (lib: LocalLibrary, id: string) =>
    lib.list().find((e) => e.track.id === id)?.track.durationMs;

  it('preenche a que faltava e CORRIGE a que estava longe da medida', async () => {
    const lib = await montar([entrada('local:zero', 0), entrada('local:curta', 14_000)]);
    lib.setTrackDuration('local:zero', 241_300);
    lib.setTrackDuration('local:curta', 240_000);
    expect(duracao(lib, 'local:zero')).toBe(241_300);
    expect(duracao(lib, 'local:curta')).toBe(240_000);
  });

  it('não troca duração boa por arredondamento, nem aceita medida absurda', async () => {
    const lib = await montar([entrada('local:a', 240_000)]);
    lib.setTrackDuration('local:a', 238_500);
    lib.setTrackDuration('local:a', Number.NaN);
    lib.setTrackDuration('local:a', 300);
    expect(duracao(lib, 'local:a')).toBe(240_000);
  });

  it('a medida numa faixa EMPRESTADA sobrevive ao snapshot do acervo que diz 0', async () => {
    const lib = await montar([entrada('local:e', 0, { origem: 'catalogo', tocavel: true })]);
    lib.setTrackDuration('local:e', 200_000);
    lib.aplicarCatalogo([entrada('local:e', 0, { tocavel: true })]);
    expect(duracao(lib, 'local:e')).toBe(200_000);
    // Quando o acervo passa a saber (a varredura mediu no cofre), ele manda.
    lib.aplicarCatalogo([entrada('local:e', 201_000, { tocavel: true })]);
    expect(duracao(lib, 'local:e')).toBe(201_000);
  });

  it('duracaoDiverge: ausente, NaN e "0:14" divergem; 1 s de diferença não', async () => {
    const lib = await montar([]);
    expect(lib.duracaoDiverge(0, 240_000)).toBe(true);
    expect(lib.duracaoDiverge(undefined, 240_000)).toBe(true);
    expect(lib.duracaoDiverge(Number.NaN, 240_000)).toBe(true);
    expect(lib.duracaoDiverge(14_000, 240_000)).toBe(true);
    expect(lib.duracaoDiverge(239_000, 240_000)).toBe(false);
  });
});
