/**
 * O RITMO TEM QUE RECUAR SOZINHO QUANDO A COTA RECLAMA.
 *
 * O lote foi aumentado para a biblioteca convergir em horas em vez de dias, e
 * medido em produção esse ritmo tomou 15 recusas por cota (429) em quarenta
 * minutos. Recuar na mão resolveria hoje e voltaria a doer amanhã — quando a
 * biblioteca crescesse, quando a cota mudasse, ou quando ninguém estivesse
 * olhando o log.
 *
 * A assimetria é deliberada: cai pela metade porque insistir sob cota estourada
 * só gera mais recusa; sobe de um quarto porque voltar correndo ao ritmo que
 * estourou é repetir o erro com passos menores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recusas = vi.fn<() => number>(() => 0);

vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => true,
  recusasPorCotaDesdeAUltimaLeitura: () => recusas(),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: {} }));
vi.mock('./agents.js', () => ({
  auditor: vi.fn(),
  auditorDeGenero: vi.fn(),
  dna: vi.fn(),
  faxineiro: vi.fn(),
  generista: vi.fn(),
  identificador: vi.fn(),
}));

describe('lote adaptativo', () => {
  beforeEach(() => {
    vi.resetModules();
    recusas.mockReturnValue(0);
  });

  it('começa no lote configurado', async () => {
    const { loteEmVigor } = await import('./curation.worker.js');
    expect(loteEmVigor()).toBeGreaterThan(0);
  });

  it('CAI PELA METADE quando a cota recusa', async () => {
    const mod = await import('./curation.worker.js');
    const inicial = mod.loteEmVigor();

    mod.__ajustarLoteParaTeste(5);
    expect(mod.loteEmVigor()).toBe(Math.max(10, Math.floor(inicial / 2)));

    // Recusa de novo: cai de novo, sem esperar ninguém intervir.
    const meio = mod.loteEmVigor();
    mod.__ajustarLoteParaTeste(3);
    expect(mod.loteEmVigor()).toBeLessThanOrEqual(meio);
  });

  it('NUNCA chega a zero — a fila não pode parar', async () => {
    const mod = await import('./curation.worker.js');
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(9);
    expect(mod.loteEmVigor()).toBeGreaterThanOrEqual(10);
  });

  it('sobe DEVAGAR quando a cota folga', async () => {
    const mod = await import('./curation.worker.js');
    const teto = mod.loteEmVigor();

    mod.__ajustarLoteParaTeste(1); // derruba
    const derrubado = mod.loteEmVigor();
    expect(derrubado).toBeLessThan(teto);

    mod.__ajustarLoteParaTeste(0); // uma volta limpa
    const subiu = mod.loteEmVigor();
    expect(subiu).toBeGreaterThan(derrubado);
    // Não pula direto de volta ao ritmo que estourou.
    expect(subiu).toBeLessThanOrEqual(teto);
  });

  it('não passa do teto configurado por mais folga que haja', async () => {
    const mod = await import('./curation.worker.js');
    const teto = mod.loteEmVigor();
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(0);
    expect(mod.loteEmVigor()).toBe(teto);
  });
});
