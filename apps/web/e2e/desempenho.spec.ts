/// <reference lib="dom" />
//
// Os tipos de DOM entram SÓ NESTE ARQUIVO. O `tsconfig.node.json`, que cobre a
// pasta `e2e`, usa `lib: ["ES2023"]` de propósito: spec de Playwright roda no
// Node, e deixar `window`/`document` visíveis lá dentro convida a chamá-los
// fora de `page.evaluate`, onde eles não existem. Aqui os corpos de `evaluate`
// realmente executam no navegador, e é só para eles que a referência serve.
/**
 * QUANTO O APP TRAVA NUM APARELHO FRACO — medido, não deduzido.
 *
 * O relato foi "estrangula qualquer aparelho", e até aqui as respostas a ele
 * foram estruturais: achar o vazamento de alças, ligar o rebaixamento ao
 * trabalho de fundo. Tudo isso é raciocínio sobre código. Nenhum deles diz
 * QUANTOS MILISSEGUNDOS o dedo ficou sem resposta num celular de entrada, e sem
 * esse número a próxima otimização é escolhida por intuição — que é como este
 * app já gastou rodadas consertando o palpite.
 *
 * ── COMO SE SIMULA UM APARELHO FRACO ──
 *
 * `Emulation.setCPUThrottlingRate` (CDP) desacelera a execução por um fator.
 * Não é um Android de entrada de verdade — não reproduz GPU fraca, memória
 * apertada, disco lento nem térmica —, mas é a parte que importa aqui: trabalho
 * de JavaScript na thread principal, que é onde nasce o travamento do toque.
 *
 * Os fatores seguem a régua que o time do Lighthouse usa:
 *   1×  o desktop que roda este teste
 *   4×  celular intermediário
 *   6×  celular de entrada
 *
 * ── O QUE SE MEDE ──
 *
 * TBT (Total Blocking Time): a soma do que passou de 50ms em cada tarefa longa.
 * É a métrica certa porque é a definição do sintoma — acima de 50ms na thread
 * principal o toque deixa de responder. Tempo total de boot NÃO serve: um boot
 * de 3s que nunca bloqueia é fluido, e um de 1,5s com meio segundo presos numa
 * tarefa é o que a pessoa chama de travado.
 *
 * ── DUAS COISAS QUE ESTE ARNÊS DE PROPÓSITO NÃO FAZ ──
 *
 * 1. NÃO fala com a rede externa. API, Firebase e CDNs são bloqueados. Sem isso
 *    a medição viraria um teste da internet do momento, e o número mudaria a
 *    cada rodada. O que sobra é o custo do CLIENTE — que é justamente o que
 *    podemos otimizar daqui.
 * 2. NÃO mede a primeira abertura. Ela semeia a biblioteca e RECARREGA: é o
 *    segundo boot que conta, porque é o que a pessoa com biblioteca cheia vive
 *    todo dia. Um app vazio abre rápido e não reproduz reclamação nenhuma.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { isolarDaRede, semear } from './arnesComum';

/** Fatores de desaceleração da CPU e o aparelho que cada um representa. */
const APARELHOS = [
  { nome: 'desktop (1x)', cpu: 1 },
  { nome: 'celular médio (4x)', cpu: 4 },
  { nome: 'celular fraco (6x)', cpu: 6 },
] as const;

/** Tamanhos de biblioteca. 5.000 é a ordem de grandeza do acervo real. */
const BIBLIOTECAS = [0, 1_000, 5_000] as const;

/** Quanto esperar depois do `load` para os plantões de fundo aparecerem. */
const ASSENTAR_MS = 12_000;

interface Relatorio {
  etapas: Record<string, number>;
  bloqueioTotalMs: number;
  piores: { inicioMs: number; duracaoMs: number; origem: string }[];
  custoPorSubsistema: Record<string, number>;
}

interface Medida {
  aparelho: string;
  faixas: number;
  bloqueioMs: number;
  ateBibliotecaMs: number | null;
  heapMb: number | null;
  piorTarefaMs: number;
  custos: Record<string, number>;
}



async function medir(page: Page, cdp: CDPSession, faixas: number, nome: string): Promise<Medida> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.goto('/');
  await semear(page, faixas);

  // Só agora estrangula: semear 5.000 entradas a 6× levaria minutos e não é o
  // que se está medindo.
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: APARELHOS.find((a) => a.nome === nome)?.cpu ?? 1,
  });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(ASSENTAR_MS);

  const relatorio = await page.evaluate(() => {
    const w = window as unknown as { radinhoPerfDados?: () => Relatorio };
    return w.radinhoPerfDados?.() ?? null;
  });
  const heapMb = await page.evaluate(() => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof m?.usedJSHeapSize === 'number' ? Math.round(m.usedJSHeapSize / 1e6) : null;
  });

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  return {
    aparelho: nome,
    faixas,
    bloqueioMs: relatorio?.bloqueioTotalMs ?? -1,
    ateBibliotecaMs: relatorio?.etapas['biblioteca-local'] ?? null,
    heapMb,
    piorTarefaMs: relatorio?.piores[0]?.duracaoMs ?? 0,
    custos: relatorio?.custoPorSubsistema ?? {},
  };
}

test.describe('desempenho de abertura em aparelho fraco', () => {
  const medidas: Medida[] = [];

  for (const aparelho of APARELHOS) {
    for (const faixas of BIBLIOTECAS) {
      test(`${aparelho.nome} · ${faixas} faixas`, async ({ page }) => {
        await isolarDaRede(page);
        const cdp = await page.context().newCDPSession(page);
        const m = await medir(page, cdp, faixas, aparelho.nome);
        medidas.push(m);

        // eslint-disable-next-line no-console -- é a saída do arnês
        console.log(
          `\n  ${m.aparelho} · ${m.faixas} faixas\n` +
            `    travamento (TBT): ${m.bloqueioMs}ms\n` +
            `    pior tarefa:      ${m.piorTarefaMs}ms\n` +
            `    até a biblioteca: ${m.ateBibliotecaMs ?? '—'}ms\n` +
            `    heap:             ${m.heapMb ?? '—'}MB\n` +
            `    subsistemas:      ${
              Object.entries(m.custos)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([k, v]) => `${k}=${v}ms`)
                .join('  ') || '—'
            }`,
        );

        // O instrumento tem de ter respondido. Se `radinhoPerfDados` sumir (ou o
        // boot quebrar), o número viria -1 e a suíte passaria medindo nada —
        // que é pior que não medir, porque parece medição.
        expect(m.bloqueioMs, 'o relatório de boot precisa existir').toBeGreaterThanOrEqual(0);
      });
    }
  }

  test.afterAll(() => {
    if (medidas.length === 0) return;
    // eslint-disable-next-line no-console -- é a saída do arnês
    console.log('\n\n===== RESUMO: travamento (TBT) em ms =====');
    // eslint-disable-next-line no-console -- é a saída do arnês
    console.table(
      medidas.map((m) => ({
        aparelho: m.aparelho,
        faixas: m.faixas,
        'TBT (ms)': m.bloqueioMs,
        'pior tarefa (ms)': m.piorTarefaMs,
        'até biblioteca (ms)': m.ateBibliotecaMs,
        'heap (MB)': m.heapMb,
      })),
    );
  });
});
