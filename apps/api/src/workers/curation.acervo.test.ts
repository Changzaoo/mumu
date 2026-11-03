/**
 * O acervo é lido SEM o vetor `dna` (39 KB por faixa — a curadoria morria por
 * falta de memória) e regravado sem apagá-lo; o `dna` só vem, em lotes de no
 * máximo 200 ids, das faixas que podem ser duplicata.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consultas: Array<{ sql: string; valores: unknown[] }> = [];
const queryRaw = vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
  consultas.push({ sql: s.join('?'), valores: v });
  return [] as unknown[];
});
const executeRaw = vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
  consultas.push({ sql: s.join('?'), valores: v });
  return 1;
});
vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => false,
  pressaoDeCotaDesdeAUltimaLeitura: () => ({ recusas: 0, chamadas: 0 }),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({
  prisma: {
    workerState: { findUnique: async () => null, upsert: async () => undefined },
    $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => queryRaw(s, ...v),
    $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => executeRaw(s, ...v),
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

const { candidatasAoDna, dnaDasCandidatas, gravarAcervoSemDna } =
  await import('./curation.worker.js');

beforeEach(() => {
  consultas.length = 0;
});

describe('candidatasAoDna', () => {
  it('só quem tem parceiro de título parecido precisa do vetor', () => {
    const ids = candidatasAoDna([
      { id: 'a', title: 'Evidências' },
      { id: 'b', title: 'Evidencias (Official Video)' },
      { id: 'c', title: 'Garota de Ipanema' },
    ]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});

describe('dnaDasCandidatas', () => {
  it('lê o dna em lotes de no máximo 200 ids', async () => {
    await dnaDasCandidatas(Array.from({ length: 450 }, (_, i) => `id${i}`));
    expect(consultas).toHaveLength(3);
    expect(consultas.map((c) => (c.valores[0] as string[]).length)).toEqual([200, 200, 50]);
  });
});

describe('gravarAcervoSemDna', () => {
  it('regrava sem apagar o dna que o banco já tinha', async () => {
    await gravarAcervoSemDna('x', { track: { title: 't' } });
    expect(consultas[0]?.sql).toMatch(/jsonb_build_object\('dna'/);
    expect(consultas[0]?.sql).toMatch(/"updatedAt" = now\(\)/);
  });
});
