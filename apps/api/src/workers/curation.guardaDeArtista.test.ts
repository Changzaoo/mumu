/**
 * A CURADORIA NÃO GRAVA ARTISTA INVENTADO: o identificador (IA) propõe um nome
 * que a faixa não prova, e `track.artists` fica como estava.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const identificador = vi.fn();
const auditor = vi.fn();

vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => true,
  pressaoDeCotaDesdeAUltimaLeitura: () => ({ recusas: 0, chamadas: 0 }),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: {} }));
vi.mock('./agents.js', () => ({
  auditor: (...a: unknown[]) => auditor(...a),
  auditorDeGenero: vi.fn(),
  dna: vi.fn(),
  faxineiro: vi.fn(),
  generista: vi.fn(),
  identificador: (...a: unknown[]) => identificador(...a),
}));

import type * as CurationWorker from './curation.worker.js';
let mod: typeof CurationWorker;

beforeAll(async () => {
  mod = await import('./curation.worker.js');
}, 60_000);

const faixa = (extra: Record<string, unknown> = {}) => ({
  track: {
    title: 'Liberdade',
    tituloOriginal: 'MC Ryan SP e MC Davi - Liberdade (DJ Boy)',
    artists: [{ name: 'Desconhecido' }],
    ...extra,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  auditor.mockResolvedValue(false); // o auditor diz "está errado"
  // Sem rede de verdade: a fonte real não confirma nada.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
  );
});

describe('auditTrack — guarda de artista inventado', () => {
  it('NÃO grava o artista que a IA inventou', async () => {
    identificador.mockResolvedValue({
      title: 'Liberdade',
      artists: ['Gusttavo Lima'],
      genre: 'Sertanejo',
    });
    const patch = await mod.__auditarFaixaParaTeste(faixa() as never);
    expect(patch).not.toBeNull();
    expect(patch).not.toHaveProperty(['track.artists']);
    // O resto da identificação (gênero) segue valendo.
    expect(patch?.['track.genre']).toBe('Sertanejo');
  });

  it('GRAVA o artista que o título original do vídeo prova', async () => {
    identificador.mockResolvedValue({
      title: 'Liberdade',
      artists: ['MC Ryan SP', 'MC Davi'],
      genre: null,
    });
    const patch = await mod.__auditarFaixaParaTeste(faixa() as never);
    const artistas = patch?.['track.artists'] as Array<{ name: string }>;
    expect(artistas.map((a) => a.name)).toEqual(['MC Ryan SP', 'MC Davi']);
  });

  it('GRAVA o artista que a fonte real confirma pelo nome', async () => {
    identificador.mockResolvedValue({
      title: 'Liberdade',
      artists: ['Gusttavo Lima'],
      genre: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ title: 'Liberdade', artist: { name: 'Gusttavo Lima' } }] }),
      })),
    );
    const patch = await mod.__auditarFaixaParaTeste(faixa() as never);
    const artistas = patch?.['track.artists'] as Array<{ name: string }>;
    expect(artistas.map((a) => a.name)).toEqual(['Gusttavo Lima']);
  });
});
