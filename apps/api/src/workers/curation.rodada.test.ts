/**
 * A VOLTA DA CURADORIA NÃO PODE TRAVAR NEM ENGORDAR.
 *
 * Exercita `startCurationWorker` inteiro com Prisma e agentes falsos: nada de banco,
 * nada de NVIDIA. O que se trava aqui são as três promessas que já custaram caro:
 * a biblioteca é lida SEM o vetor `dna` (OOM de 1 GB), um item que sempre falha não
 * para a fila, e a cota recusada encolhe o lote da volta seguinte.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const pressao = vi.fn(() => ({ recusas: 0, chamadas: 0 }));
const grupos = vi.fn<() => Promise<Array<{ userId: string }>>>(async () => []);
const findMany = vi.fn<(a: { where: { userId: string } }) => Promise<unknown[]>>(async () => []);
const update = vi.fn(async (_a: unknown) => undefined);
const sqlLidos: string[] = [];
const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
  sqlLidos.push(strings.join('?'));
  return [] as unknown[];
});
const auditor = vi.fn<(f: unknown) => Promise<boolean | null>>(async () => true);

vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => true,
  pressaoDeCotaDesdeAUltimaLeitura: () => pressao(),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({
  prisma: {
    workerState: { findUnique: async () => null, upsert: async () => undefined },
    userCollectionItem: {
      groupBy: () => grupos(),
      findMany: (a: { where: { userId: string } }) => findMany(a),
      update: (a: unknown) => update(a),
    },
    $queryRaw: (s: TemplateStringsArray) => queryRaw(s),
    $executeRaw: vi.fn(async () => 0),
  },
}));
vi.mock('./agents.js', () => ({
  auditor: (f: unknown) => auditor(f),
  auditorDeGenero: vi.fn(async () => []),
  dna: vi.fn(async () => []),
  faxineiro: vi.fn(async () => []),
  generista: vi.fn(async () => []),
  generoRealDoArtista: vi.fn(async () => null),
  identificador: vi.fn(async () => null),
}));

import { env } from '../config/index.js';
import type * as Worker from './curation.worker.js';

const linha = (itemId: string, title: string) => ({
  itemId,
  data: { track: { title, artists: [{ name: 'Fulano' }], genre: 'Rock' } },
});

let parar: () => void = () => undefined;

async function umaVolta(): Promise<typeof Worker> {
  vi.resetModules();
  const mod = await import('./curation.worker.js');
  parar = mod.startCurationWorker();
  // A volta termina quando a pressão da cota é lida (uma vez, no fim).
  await vi.waitFor(() => expect(pressao).toHaveBeenCalledTimes(1), { timeout: 20_000 });
  parar();
  return mod;
}

// Import frio pesado (@radinho/shared) fora do limite de 5 s do 1º teste.
beforeAll(async () => {
  await import('./curation.worker.js');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  sqlLidos.length = 0;
  pressao.mockReturnValue({ recusas: 0, chamadas: 0 });
  grupos.mockResolvedValue([]);
  findMany.mockResolvedValue([]);
  auditor.mockResolvedValue(true);
});
afterEach(() => parar());

describe('curadoria — uma volta', () => {
  it('fila vazia: ninguém com biblioteca, a volta fecha e só lê a cota uma vez', async () => {
    await umaVolta();
    expect(findMany).not.toHaveBeenCalled();
    expect(pressao).toHaveBeenCalledTimes(1);
  });

  it('lê a biblioteca SEM o vetor dna (data - dna), senão o worker morre por OOM', async () => {
    grupos.mockResolvedValue([{ userId: 'u1' }]);
    findMany.mockResolvedValue([linha('a', 'Faixa A')]);
    await umaVolta();
    const leituras = sqlLidos.filter((s) => s.includes('UserCollectionItem'));
    expect(leituras.length).toBeGreaterThan(0);
    expect(leituras.every((s) => /data::jsonb - 'dna'/.test(s))).toBe(true);
  });

  it('item que sempre falha NÃO trava a fila: os outros são auditados', async () => {
    grupos.mockResolvedValue([{ userId: 'u1' }]);
    findMany.mockResolvedValue([linha('ruim', 'Ruim'), linha('b', 'Boa B'), linha('c', 'Boa C')]);
    auditor.mockImplementation(async (f) => {
      if ((f as { title: string }).title === 'Ruim') throw new Error('sempre falha');
      return true;
    });
    await umaVolta();
    const titulos = auditor.mock.calls.map((c) => (c[0] as { title: string }).title);
    expect(titulos).toEqual(expect.arrayContaining(['Ruim', 'Boa B', 'Boa C']));
    // As boas receberam o carimbo de auditoria; a ruim não gravou nada.
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('usuário cuja leitura estoura não impede o próximo usuário', async () => {
    grupos.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    findMany.mockImplementation(async (a) => {
      if (a.where.userId === 'u1') throw new Error('banco caiu');
      return [linha('x', 'Faixa X')];
    });
    await umaVolta();
    expect(auditor).toHaveBeenCalledTimes(1);
  });

  it('cota recusada na volta: o lote da próxima encolhe, mas nunca abaixo de 10', async () => {
    grupos.mockResolvedValue([]);
    pressao.mockReturnValue({ recusas: 7, chamadas: 20 });
    const mod = await umaVolta();
    expect(mod.loteEmVigor()).toBeGreaterThanOrEqual(10);
    // estreia = metade do teto; a recusa corta de novo pela metade (ou cai no piso)
    const estreia = Math.max(10, Math.floor(env.CURATION_BATCH / 2));
    expect(mod.loteEmVigor()).toBe(Math.max(10, Math.floor(estreia / 2)));
  });

  it('faixa sem título não é auditada (não gasta cota)', async () => {
    grupos.mockResolvedValue([{ userId: 'u1' }]);
    findMany.mockResolvedValue([{ itemId: 'z', data: { track: { title: '  ', artists: [] } } }]);
    await umaVolta();
    expect(auditor).not.toHaveBeenCalled();
  });
});
