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

/**
 * Semeia N entradas no registro (IndexedDB), no MESMO formato que o app grava.
 *
 * Roda dentro da página, e não por fixture, porque o registro é IndexedDB puro
 * — não há caminho de rede para injetá-lo por fora.
 */
async function semear(page: Page, quantas: number): Promise<void> {
  if (quantas === 0) return;
  await page.evaluate(async (n: number) => {
    const entradas = Array.from({ length: n }, (_, i) => {
      const id = `local:seed-${i}`;
      return {
        track: {
          id,
          title: `Faixa de teste ${i}`,
          durationMs: 225_000,
          trackNumber: 1,
          discNumber: 1,
          explicit: false,
          playsCount: 0,
          dominantColor: null,
          loudnessLufs: -10,
          isLiked: false,
          album: {
            id: `album-${i % 400}`,
            title: `Álbum ${i % 400}`,
            slug: `album-${i % 400}`,
            coverUrl: null,
          },
          artists: [
            {
              id: `artist-${i % 300}`,
              name: `Artista ${i % 300}`,
              slug: `artist-${i % 300}`,
              imageUrl: null,
            },
          ],
          // Gênero em parte do acervo: sem isto o agente de gênero veria a
          // biblioteca INTEIRA como pendente, que não é o caso comum.
          genre: i % 3 === 0 ? null : ['Pop', 'Rock', 'Samba', 'K-Pop'][i % 4],
          // CAPA NA MAIORIA — e a primeira versão deste arnês errou aqui.
          //
          // Semear `coverUrl: null` em TODAS as entradas parece inofensivo e não
          // é: `restoreEmbeddedCovers` só vai ao IndexedDB para quem está sem
          // capa, então uma biblioteca 100% sem capa dispara uma leitura por
          // faixa e infla essa fase muito além do real. Uma de cada dez sem capa
          // é o que se vê numa biblioteca de verdade.
          coverUrl: i % 10 === 0 ? null : `https://cdn.exemplo.test/capa/${i % 400}.jpg`,
          streamUrl: null,
          uploadedByUserId: null,
        },
        addedAt: new Date(Date.now() - i * 60_000).toISOString(),
        sizeBytes: 8_000_000,
        mimeType: 'audio/mpeg',
        tocavel: true,
        // MISTURA DE DONO, e o outro erro da primeira versão.
        //
        // Marcar tudo como 'catalogo' zerava o custo que se queria medir:
        // `carregarRegistro` regrava o registro filtrando FORA o catálogo, então
        // uma biblioteca 100% emprestada gravava uma lista vazia e a regravação
        // saía de graça. A biblioteca de uma pessoa é majoritariamente DELA —
        // 40% aqui — e é o tamanho dessa parte que decide o custo da regravação.
        ...(i % 10 < 6
          ? { origem: 'catalogo' as const }
          : {
              remoteUrl: `https://importer.exemplo.test/blob/${id}`,
              sourceUrl: `https://www.youtube.com/watch?v=seed${i}`,
              contentHash: `hash-${i}`,
            }),
      };
    });

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aurial-registro', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('biblioteca')) db.createObjectStore('biblioteca');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('biblioteca', 'readwrite');
        tx.objectStore('biblioteca').put(entradas, 'entradas');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, quantas);
}

/**
 * Corta a rede: mede-se o cliente, não a internet do momento.
 *
 * MESMA ORIGEM NÃO BASTA como critério. A primeira versão deste filtro liberava
 * tudo em `localhost:4173`, e a API entra por AÍ — `/api/v1/...` é servido pelo
 * proxy do Vite, que repassa para o servidor de verdade. Resultado: as chamadas
 * escapavam, morriam em ECONNREFUSED depois de um tempo variável, e esse tempo
 * entrava na medição. O número virava metade produto, metade rede.
 *
 * Agora só passa o que o próprio `dist` serve — documento, assets, ícones e o
 * service worker. Todo o resto é abortado NA HORA, o que é determinístico: o
 * app trata a falha pelo mesmo caminho de quando está offline.
 */
const CAMINHOS_ESTATICOS = /^\/(assets\/|icons\/|fonts\/|manifest|favicon|sw\.js|workbox|$)/;

async function isolarDaRede(page: Page): Promise<void> {
  await page.route('**/*', (rota) => {
    const url = new URL(rota.request().url());
    const local = url.host === 'localhost:4173';
    if (local && CAMINHOS_ESTATICOS.test(url.pathname)) return rota.continue();
    // Rotas do SPA (/, /search…) também são documento servido pelo dist.
    if (local && rota.request().resourceType() === 'document') return rota.continue();
    return rota.abort();
  });
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
