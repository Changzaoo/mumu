/**
 * `patchDeAlbum` decide O QUE gravar a partir do que o catálogo achou — e
 * respeita o que a curadoria já fixou: completa número do MESMO disco, nunca
 * troca o álbum por outro, nunca apaga capa.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => false,
  pressaoDeCotaDesdeAUltimaLeitura: () => ({ recusas: 0, chamadas: 0 }),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({
  prisma: {
    workerState: { findUnique: async () => null, upsert: async () => undefined },
    userCollectionItem: {
      groupBy: async () => [],
      findMany: async () => [],
      update: async () => undefined,
    },
    catalogTrack: { findMany: async () => [], update: async () => undefined },
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  },
}));
vi.mock('./agents.js', () => ({
  auditor: vi.fn(),
  auditorDeGenero: vi.fn(),
  dna: vi.fn(),
  faxineiro: vi.fn(),
  generista: vi.fn(),
  generoRealDoArtista: vi.fn(),
  identificador: vi.fn(),
}));

import { patchDeAlbum, precisaDeAlbum } from './curation.worker.js';

const achado = {
  album: 'In the Zone',
  trackNumber: 6,
  discNumber: 1,
  trackCount: 13,
  releaseYear: 2003,
  coverUrl: 'https://capa/600.jpg',
  fonte: 'deezer' as const,
};

describe('patchDeAlbum', () => {
  it('faixa sem álbum: grava álbum com total, número, disco, ano e capa (se faltava)', () => {
    const p = patchDeAlbum(
      { title: 'Toxic', artists: [{ name: 'Britney Spears' }], coverUrl: '' },
      'x1',
      achado,
    );
    expect(p).toEqual({
      'track.album': {
        id: 'local-album:x1',
        title: 'In the Zone',
        slug: '',
        coverUrl: 'https://capa/600.jpg',
        trackCount: 13,
      },
      'track.trackNumber': 6,
      'track.discNumber': 1,
      'track.releaseYear': 2003,
      'track.coverUrl': 'https://capa/600.jpg',
    });
  });

  it('capa existente não é trocada; a do álbum novo usa a capa da própria faixa', () => {
    const p = patchDeAlbum({ title: 'Toxic', coverUrl: 'https://minha/capa.jpg' }, 'x1', {
      ...achado,
      coverUrl: null,
    });
    expect(p?.['track.coverUrl']).toBeUndefined();
    expect((p?.['track.album'] as { coverUrl: string }).coverUrl).toBe('https://minha/capa.jpg');
  });

  it('álbum já fixado e igual ao achado: só completa número e total', () => {
    const p = patchDeAlbum(
      {
        title: 'Toxic',
        album: { id: 'a', title: 'In The Zone', slug: '', coverUrl: 'c' },
        coverUrl: 'c',
        releaseYear: 2003,
      },
      'x1',
      achado,
    );
    expect(p).toEqual({
      'track.album.trackCount': 13,
      'track.trackNumber': 6,
      'track.discNumber': 1,
    });
  });

  it('álbum já fixado e DIFERENTE do achado: não mexe em nada', () => {
    const p = patchDeAlbum(
      {
        title: 'Toxic',
        album: { id: 'a', title: 'Greatest Hits: My Prerogative', slug: '', coverUrl: 'c' },
      },
      'x1',
      achado,
    );
    expect(p).toBeNull();
  });

  it('nada a acrescentar: null (não grava à toa)', () => {
    const p = patchDeAlbum(
      {
        title: 'Toxic',
        album: { id: 'a', title: 'In the Zone', slug: '', coverUrl: 'c', trackCount: 13 },
        trackNumber: 6,
        discNumber: 1,
        coverUrl: 'c',
        releaseYear: 2003,
      },
      'x1',
      achado,
    );
    expect(p).toBeNull();
  });
});

describe('precisaDeAlbum', () => {
  it('sem álbum, ou com álbum mas sem número: precisa; com os dois: não', () => {
    expect(precisaDeAlbum({ title: 'x' })).toBe(true);
    expect(precisaDeAlbum({ title: 'x', album: { title: 'Y' } })).toBe(true);
    expect(precisaDeAlbum({ title: 'x', album: { title: 'Y' }, trackNumber: 3 } as never)).toBe(
      false,
    );
  });
});
