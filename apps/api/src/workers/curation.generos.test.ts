/**
 * `preencherGeneros` TEM QUE GIRAR, NÃO TRAVAR NA MESMA FAIXA.
 *
 * Antes, as primeiras N faixas sem gênero (em ordem de itemId) eram refeitas a
 * cada volta: se o modelo respondia DESCONHECIDO para elas, as seguintes nunca
 * eram classificadas. Aqui trava-se o rodízio: tentadas há mais tempo primeiro,
 * 3 tentativas = 7 dias de descanso, e o contador zera quando a faixa ganha gênero.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const pressao = vi.fn(() => ({ recusas: 0, chamadas: 0 }));
const grupos = vi.fn<() => Promise<Array<{ userId: string }>>>(async () => []);
let biblioteca: Array<{ itemId: string; data: Record<string, unknown> }> = [];
const queryRaw = vi.fn(async (strings: TemplateStringsArray) =>
  strings.join('?').includes('UserCollectionItem') ? biblioteca : [],
);
/** Cada gravação da biblioteca (sem dna) chega como JSON na posição 1 do template. */
interface Gravada {
  generoTentadoEm?: string | null;
  generoTentativas?: number;
  track?: { genre?: string | null };
}
const gravacoes: Array<{ itemId: string; data: Gravada }> = [];
const executeRaw = vi.fn(async (_s: TemplateStringsArray, ...v: unknown[]) => {
  const data = JSON.parse(v[0] as string) as Gravada;
  // v = [json, json, json, userId, itemId]; o itemId é o último valor interpolado.
  gravacoes.push({ itemId: String(v[v.length - 1]), data });
  return 0;
});
const generista = vi.fn<(f: Array<{ title: string }>) => Promise<Array<string | null>>>(async (f) =>
  f.map(() => null),
);

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
      findMany: async () => [],
      update: async () => undefined,
    },
    $queryRaw: (s: TemplateStringsArray) => queryRaw(s),
    $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => executeRaw(s, ...v),
  },
}));
vi.mock('./agents.js', () => ({
  auditor: vi.fn(async () => true),
  auditorDeGenero: vi.fn(async () => []),
  dna: vi.fn(async () => []),
  faxineiro: vi.fn(async () => []),
  generista: (f: Array<{ title: string }>) => generista(f),
  generoRealDoArtista: vi.fn(async () => null),
  identificador: vi.fn(async () => null),
}));

import type * as Worker from './curation.worker.js';

const DIA = 24 * 3600_000;
const faixa = (
  itemId: string,
  extra: Record<string, unknown> = {},
): { itemId: string; data: Record<string, unknown> } => ({
  itemId,
  data: { track: { title: `Faixa ${itemId}`, artists: [{ name: `Artista ${itemId}` }] }, ...extra },
});

let parar: () => void = () => undefined;
async function umaVolta(): Promise<typeof Worker> {
  vi.resetModules();
  const mod = await import('./curation.worker.js');
  parar = mod.startCurationWorker();
  await vi.waitFor(() => expect(pressao).toHaveBeenCalledTimes(1), { timeout: 20_000 });
  parar();
  return mod;
}

beforeAll(async () => {
  await import('./curation.worker.js');
}, 60_000);
beforeEach(() => {
  vi.clearAllMocks();
  gravacoes.length = 0;
  grupos.mockResolvedValue([{ userId: 'u1' }]);
  generista.mockImplementation(async (f) => f.map(() => null));
});
afterEach(() => parar());

describe('curadoria — rodízio de preencherGeneros', () => {
  it('nunca tentadas vão antes das tentadas, e as mais antigas antes das recentes', async () => {
    const agora = Date.now();
    biblioteca = [
      faixa('a', { generoTentadoEm: new Date(agora - 1 * DIA).toISOString(), generoTentativas: 1 }),
      faixa('b'),
      faixa('c', { generoTentadoEm: new Date(agora - 5 * DIA).toISOString(), generoTentativas: 2 }),
    ];
    await umaVolta();
    const titulos = generista.mock.calls[0]![0].map((f) => f.title);
    expect(titulos).toEqual(['Faixa b', 'Faixa c', 'Faixa a']);
  });

  it('tentativa sem rótulo grava generoTentadoEm (ISO) e soma generoTentativas', async () => {
    biblioteca = [faixa('a'), faixa('b', { generoTentativas: 1 })];
    await umaVolta();
    const a = gravacoes.find((g) => g.itemId === 'a')!.data;
    const b = gravacoes.find((g) => g.itemId === 'b')!.data;
    expect(a.generoTentativas).toBe(1);
    expect(b.generoTentativas).toBe(2);
    expect(new Date(a.generoTentadoEm ?? '').toISOString()).toBe(a.generoTentadoEm);
    expect(a.track?.genre).toBeUndefined();
  });

  it('3 tentativas = descanso de 7 dias; passado o descanso, volta à fila', async () => {
    const agora = Date.now();
    biblioteca = [
      faixa('cansada', {
        generoTentadoEm: new Date(agora - 2 * DIA).toISOString(),
        generoTentativas: 3,
      }),
      faixa('descansada', {
        generoTentadoEm: new Date(agora - 8 * DIA).toISOString(),
        generoTentativas: 3,
      }),
      faixa('nova'),
    ];
    await umaVolta();
    const titulos = generista.mock.calls[0]![0].map((f) => f.title);
    expect(titulos).toContain('Faixa nova');
    expect(titulos).toContain('Faixa descansada');
    expect(titulos).not.toContain('Faixa cansada');
  });

  it('quando a faixa ganha gênero, os dois campos são zerados', async () => {
    biblioteca = [faixa('a', { generoTentadoEm: new Date().toISOString(), generoTentativas: 2 })];
    generista.mockImplementation(async (f) => f.map(() => 'Rock'));
    await umaVolta();
    const g = gravacoes.find((x) => x.itemId === 'a')!.data;
    expect(g.track?.genre).toBe('Rock');
    expect(g.generoTentativas).toBe(0);
    expect(g.generoTentadoEm).toBeNull();
  });
});
