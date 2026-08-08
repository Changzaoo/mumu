/**
 * O RITMO TEM QUE RECUAR SOZINHO QUANDO A COTA RECLAMA — E LEMBRAR DEPOIS.
 *
 * O lote foi aumentado para a biblioteca convergir em horas em vez de dias, e
 * medido em produção esse ritmo tomou recusas por cota (429) às dúzias. Recuar
 * na mão resolveria hoje e voltaria a doer amanhã — quando a biblioteca
 * crescesse, quando a cota mudasse, ou quando ninguém estivesse olhando o log.
 *
 * A assimetria é deliberada: cai pela metade porque insistir sob cota estourada
 * só gera mais recusa; sobe de um quarto porque voltar correndo ao ritmo que
 * estourou é repetir o erro com passos menores.
 *
 * Os três casos que faltavam, e que este arquivo passa a travar:
 *
 *  1. O ESTADO É DE MÓDULO E O WORKER É 24/7 — mas o contêiner não é. O lote
 *     aprendido morria a cada deploy. Medido: o worker recriado às 10:55Z voltou
 *     ao teto de 150 e queimou 222 recusas reaprendendo a mesma descida.
 *  2. VOLTA SILENCIOSA NÃO É VOLTA FOLGADA. Zero recusas com zero chamadas era
 *     lido como folga, e o lote subia sozinho numa biblioteca já convergida.
 *  3. A LEITURA DO CONTADOR ZERA. Quem lê fica dono da janela — então só pode
 *     existir UM leitor por volta, senão a segunda leitura vê zero.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pressao = vi.fn<() => { recusas: number; chamadas: number }>(() => ({
  recusas: 0,
  chamadas: 0,
}));

/** O que estaria gravado na tabela `WorkerState` neste boot. */
let loteGravado: { lote: number } | null = null;
const upsert = vi.fn(async (args: unknown) => {
  const { create, update } = args as { create?: unknown; update?: unknown };
  loteGravado = ((update as { value?: { lote: number } })?.value ??
    (create as { value?: { lote: number } })?.value)!;
  return undefined;
});
const findUnique = vi.fn(async () => (loteGravado ? { value: loteGravado } : null));

vi.mock('../infra/ai/nvidia.js', () => ({
  isNvidiaConfigured: () => true,
  pressaoDeCotaDesdeAUltimaLeitura: () => pressao(),
  nvidiaChat: vi.fn(),
  nvidiaEmbed: vi.fn(),
}));
vi.mock('../infra/db/prisma.js', () => ({
  prisma: { workerState: { findUnique: () => findUnique(), upsert: (a: unknown) => upsert(a) } },
}));
vi.mock('./agents.js', () => ({
  auditor: vi.fn(),
  auditorDeGenero: vi.fn(),
  dna: vi.fn(),
  faxineiro: vi.fn(),
  generista: vi.fn(),
  identificador: vi.fn(),
}));

/** Uma volta que de fato falou com a NVIDIA e não tomou recusa. */
const folgada = { recusas: 0, chamadas: 40 };
/** Uma volta que não teve nada para fazer — nem uma chamada. */
const silenciosa = { recusas: 0, chamadas: 0 };

// Só para o tipo: o `import()` de verdade acontece dentro de `reiniciarWorker`,
// depois de `vi.resetModules()`, que é o que simula o processo novo.
import type * as CurationWorker from './curation.worker.js';

/** Simula um deploy: processo novo, estado de módulo zerado, banco intacto. */
async function reiniciarWorker(): Promise<typeof CurationWorker> {
  vi.resetModules();
  const mod = await import('./curation.worker.js');
  await mod.__carregarLoteParaTeste();
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  loteGravado = null;
  pressao.mockReturnValue(silenciosa);
});

describe('lote adaptativo', () => {
  it('CAI PELA METADE quando a cota recusa', async () => {
    const mod = await reiniciarWorker();
    const inicial = mod.loteEmVigor();

    mod.__ajustarLoteParaTeste({ recusas: 5, chamadas: 40 });
    expect(mod.loteEmVigor()).toBe(Math.max(10, Math.floor(inicial / 2)));

    // Recusa de novo: cai de novo, sem esperar ninguém intervir.
    const meio = mod.loteEmVigor();
    mod.__ajustarLoteParaTeste({ recusas: 3, chamadas: 20 });
    expect(mod.loteEmVigor()).toBeLessThanOrEqual(meio);
  });

  it('NUNCA chega a zero — a fila não pode parar', async () => {
    const mod = await reiniciarWorker();
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste({ recusas: 9, chamadas: 9 });
    expect(mod.loteEmVigor()).toBeGreaterThanOrEqual(10);
  });

  it('sobe DEVAGAR quando a cota folga', async () => {
    const mod = await reiniciarWorker();
    const partida = mod.loteEmVigor();

    mod.__ajustarLoteParaTeste({ recusas: 1, chamadas: 40 }); // derruba
    const derrubado = mod.loteEmVigor();
    expect(derrubado).toBeLessThan(partida);

    mod.__ajustarLoteParaTeste(folgada); // uma volta limpa
    expect(mod.loteEmVigor()).toBeGreaterThan(derrubado);
  });

  it('não passa do teto configurado por mais folga que haja', async () => {
    const mod = await reiniciarWorker();
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(folgada);
    // O teto vem do ambiente e é o mesmo que a estreia usa pela metade.
    const teto = mod.loteEmVigor();
    mod.__ajustarLoteParaTeste(folgada);
    expect(mod.loteEmVigor()).toBe(teto);
  });
});

describe('lote adaptativo — o que a volta silenciosa faz', () => {
  it('NÃO sobe o lote numa volta em que nenhuma chamada foi feita', async () => {
    // O cenário real: biblioteca já convergida. Não há faixa pendente, então a
    // volta inteira passa sem uma única chamada à NVIDIA — e "zero recusas" era
    // lido como "cota folgada". O lote escalava sozinho, de volta ao ritmo que
    // tinha estourado, e a próxima leva de importações tomava a rajada inteira.
    const mod = await reiniciarWorker();
    mod.__ajustarLoteParaTeste({ recusas: 4, chamadas: 40 });
    const derrubado = mod.loteEmVigor();

    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(silenciosa);

    expect(mod.loteEmVigor()).toBe(derrubado);
  });

  it('mas a recusa numa volta silenciosa ainda derruba', async () => {
    // Recusa sem chamada contada não deveria acontecer, mas se acontecer o
    // lado seguro é o de baixo.
    const mod = await reiniciarWorker();
    const antes = mod.loteEmVigor();
    mod.__ajustarLoteParaTeste({ recusas: 2, chamadas: 0 });
    expect(mod.loteEmVigor()).toBeLessThan(antes);
  });
});

describe('lote adaptativo — o estado sobrevive ao contêiner', () => {
  it('ESTREIA PELA METADE DO TETO, não no teto', async () => {
    // Estrear no teto é começar pelo ritmo que a produção já provou ser alto
    // demais: foi assim que o worker recriado queimou 222 recusas.
    const mod = await reiniciarWorker();
    const estreia = mod.loteEmVigor();

    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(folgada);
    const teto = mod.loteEmVigor();

    expect(estreia).toBeLessThan(teto);
    expect(estreia).toBe(Math.max(10, Math.floor(teto / 2)));
  });

  it('LEMBRA o ritmo aprendido depois de um deploy', async () => {
    const antes = await reiniciarWorker();
    const estreia = antes.loteEmVigor();
    antes.__ajustarLoteParaTeste({ recusas: 12, chamadas: 40 });
    antes.__ajustarLoteParaTeste({ recusas: 8, chamadas: 30 });
    const aprendido = antes.loteEmVigor();
    // A descida aconteceu de verdade — senão o teste não prova nada.
    expect(aprendido).toBeLessThan(estreia);

    // O deploy: processo novo, `loteAtual` zerado, banco intacto.
    const depois = await reiniciarWorker();

    expect(depois.loteEmVigor()).toBe(aprendido);
    // A prova do defeito: sem memória, o processo novo voltaria à estreia.
    expect(depois.loteEmVigor()).not.toBe(estreia);
  });

  it('grava toda vez que o ritmo MUDA, e só então', async () => {
    const mod = await reiniciarWorker();
    expect(upsert).not.toHaveBeenCalled();

    mod.__ajustarLoteParaTeste({ recusas: 3, chamadas: 40 });
    expect(upsert).toHaveBeenCalledTimes(1);

    // Já no piso: não muda, não grava.
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste({ recusas: 3, chamadas: 40 });
    const gravacoesAteOPiso = upsert.mock.calls.length;
    mod.__ajustarLoteParaTeste({ recusas: 3, chamadas: 40 });
    expect(upsert).toHaveBeenCalledTimes(gravacoesAteOPiso);
  });

  it('o teto do ambiente MANDA sobre o valor lembrado', async () => {
    // Se o operador baixar `CURATION_BATCH`, a memória não pode desfazer isso.
    const mod = await reiniciarWorker();
    for (let i = 0; i < 20; i += 1) mod.__ajustarLoteParaTeste(folgada);
    const teto = mod.loteEmVigor();

    loteGravado = { lote: teto * 10 }; // alguém lembrou de um teto antigo, maior
    const depois = await reiniciarWorker();
    expect(depois.loteEmVigor()).toBe(teto);
  });

  it('banco fora do ar não impede o worker de rodar — estreia cauteloso', async () => {
    findUnique.mockRejectedValueOnce(new Error('relation "WorkerState" does not exist'));
    const mod = await reiniciarWorker();
    expect(mod.loteEmVigor()).toBeGreaterThanOrEqual(10);
  });

  it('gravação que falha não derruba a volta', async () => {
    const mod = await reiniciarWorker();
    upsert.mockRejectedValueOnce(new Error('sem banco'));
    expect(() => mod.__ajustarLoteParaTeste({ recusas: 1, chamadas: 40 })).not.toThrow();
  });
});
