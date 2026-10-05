/// <reference lib="dom" />
/**
 * BIBLIOTECA REAL NO INDEXEDDB — o que a bancada "limpa" não exercitava.
 *
 * Nas outras specs o aparelho emulado abre com o registro PRÓPRIO vazio (só o
 * acervo, que vem do servidor). O aparelho de verdade do dono tem ~5,7 mil
 * faixas no registro por faixa (`aurial-registro-faixas`) E o acervo no cofre
 * do catálogo. A telemetria dele mostrou o custo exatamente aí: leitura
 * paginada do registro (400–600 ms numa única tarefa), gravação do catálogo
 * inteiro (350 ms) e a Home remontando do zero a cada volta.
 *
 * Cenário (por repetição, contexto novo, CPU e rede do perfil principal):
 *   1. abre o app uma vez (service worker + acervo gravado no IndexedDB);
 *   2. SEMEIA o registro por faixa com ~5,7 mil entradas no formato real
 *      (campos completos: remoteUrl, sourceUrl, contentHash, streamUrl…);
 *   3. recarrega duas vezes: `boot-1` (primeira abertura com a biblioteca) e
 *      `boot-2` (a seguinte — é o app de todo dia, com tudo já no disco);
 *   4. sai da Home e volta pela aba "Início" cinco vezes (`voltar-home`).
 *
 * Mede de fora (a mesma sonda das outras specs), então vale igual para o
 * bundle antigo (`G34_DIST`) e o novo: maior tarefa longa e TBT do boot, tempo
 * até o conteúdo (sem esqueleto) e o clique → Home de pé.
 *
 *   G34_GRUPO=biblioteca pnpm perf:g34
 *   node e2e/g34Resumo.mjs biblioteca
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { CPU_PADRAO, estrangular, novoContextoG34, prepararVisitante } from './motoG34';
import { gravar, instalarSonda, lerSonda, memoriaEDom, PASTA, tbt } from './g34Medicao';

const REPS = Number(process.env.G34_REPS ?? 3);
const GRUPO = process.env.G34_GRUPO ?? 'tudo';
const ROTULO = process.env.G34_ROTULO ?? 'atual';
const JANELA_MS = 8_000;
const passo = (m: string): void =>
  void process.stderr.write(`[biblioteca] ${m}
`);

interface EntradaCatalogo {
  track: { id: string; title: string; artists?: { name: string }[]; coverUrl?: string | null };
  [k: string]: unknown;
}

/** Cria as entradas "do aparelho" no formato que o registro por faixa guarda. */
function entradasDoAparelho(): unknown[] {
  const bruto = JSON.parse(readFileSync(join(PASTA, 'fixtures', 'catalogo.json'), 'utf8')) as {
    data: EntradaCatalogo[];
  };
  return bruto.data.map((e, i) => ({
    ...e,
    track: {
      ...e.track,
      // O registro próprio guarda as URLs de verdade (o acervo chega magro).
      streamUrl: `https://aurial-api.nexusholding.xyz/blob/${e.track.id}?t=${'x'.repeat(48)}`,
    },
    addedAt: new Date(Date.now() - i * 60_000).toISOString(),
    sizeBytes: 4_200_000 + i,
    mimeType: 'audio/mpeg',
    sourceUrl: `https://www.youtube.com/watch?v=${e.track.id.slice(-11)}`,
    remoteUrl: `https://aurial-api.nexusholding.xyz/blob/${e.track.id}?t=${'y'.repeat(48)}`,
    contentHash: 'a'.repeat(64),
    tocavel: undefined,
    origem: undefined,
  }));
}

/** Escreve as entradas direto no IndexedDB do registro por faixa (mesmo esquema do app). */
async function semear(page: Page, entradas: unknown[]): Promise<number> {
  return page.evaluate(
    (lista) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('aurial-registro-faixas', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('faixas'))
            req.result.createObjectStore('faixas');
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('faixas', 'readwrite');
          const store = tx.objectStore('faixas');
          store.clear();
          for (const e of lista as { track: { id: string } }[]) store.put(e, e.track.id);
          tx.oncomplete = () => {
            db.close();
            resolve(lista.length);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    entradas,
  );
}

async function medirBoot(page: Page, rotulo: string, rep: number, cpu: number): Promise<void> {
  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
  const ateLoad = Date.now() - t0;
  await page.waitForTimeout(JANELA_MS);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { load: n.loadEventEnd };
  });
  const s = await lerSonda(page);
  const fim = nav.load + JANELA_MS;
  const lts = s.longtasks.filter((t) => t.s <= fim);
  const mem = await memoriaEDom(page);
  // Quem travou: os piores quadros longos com o script culpado.
  const piores = [...s.loaf]
    .sort((a, b) => b.d - a.d)
    .slice(0, 3)
    .map((q) => ({
      d: Math.round(q.d),
      scripts: q.scripts.map((x) => `${x.d}ms ${x.i} ${x.inv}`).slice(0, 3),
    }));
  gravar('biblioteca', {
    cenario: rotulo,
    rotulo: ROTULO,
    rep,
    cpu,
    semEsqueleto: Math.round(s.semEsqueletoEm || s.fcp),
    fcp: Math.round(s.fcp),
    lcp: Math.round(s.lcp),
    tbt: tbt(lts, s.fcp, fim),
    tbtTotal: tbt(lts, 0, fim),
    nLongTasks: lts.length,
    piorTarefa: Math.round(Math.max(0, ...lts.map((t) => t.d))),
    ...mem,
    piores,
    wallAteLoad: ateLoad,
  });
}

/** Clique → Home de pé (URL trocou, sem esqueleto, 2 quadros), como `nav` mede. */
async function esperarDePe(page: Page, destino: string, teto = 20_000): Promise<number> {
  return page.evaluate(
    ({ destino, teto }) =>
      new Promise<number>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t0 = (window as any).__toque || performance.now();
        const checar = (): void => {
          const chegou = location.pathname === destino;
          const semEsq =
            !document.querySelector('main .skeleton') && !!document.querySelector('main');
          if (chegou && semEsq) {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - t0)),
            );
            return;
          }
          if (performance.now() - t0 > teto) return resolve(-1);
          setTimeout(checar, 16);
        };
        checar();
      }),
    { destino, teto },
  );
}

test.describe('biblioteca real no IndexedDB', () => {
  test.skip(GRUPO !== 'tudo' && GRUPO !== 'biblioteca');

  test('boot quente com ~5,7 mil faixas no registro + sair e voltar à Home 5x', async ({
    browser,
  }) => {
    const entradas = entradasDoAparelho();
    for (let rep = 1; rep <= REPS; rep++) {
      const ctx = await novoContextoG34(browser);
      await prepararVisitante(ctx);
      await ctx.addInitScript(instalarSonda);
      await ctx.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        window.addEventListener('pointerdown', (e) => (w.__toque = e.timeStamp), true);
      });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await estrangular(cdp, 1, null); // semeadura sem estrangular
      passo(`rep ${rep}: abrindo`);
      await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
      passo('carregou; esperando SW');
      await page
        .evaluate(() =>
          Promise.race([
            navigator.serviceWorker.ready.then(() => true),
            new Promise<boolean>((r) => setTimeout(() => r(false), 15_000)),
          ]),
        )
        .catch(() => false);
      await page.waitForTimeout(6_000); // acervo gravado no cofre do catálogo
      passo('SW ok/timeout; semeando');
      const n = await semear(page, entradas);
      passo(`semeou ${n}`);
      if (n < 5000) throw new Error(`semeadura curta: ${n}`);
      await estrangular(cdp, CPU_PADRAO, '4g');

      passo('boot-1');
      await medirBoot(page, 'boot-1 (1ª abertura com a biblioteca)', rep, CPU_PADRAO);
      await medirBoot(page, 'boot-2 (abertura seguinte)', rep, CPU_PADRAO);

      passo('voltas');
      for (let volta = 1; volta <= 5; volta++) {
        const aba = (nome: string) =>
          page
            .locator('[aria-label="Navegação"] a', { hasText: nome })
            .boundingBox({ timeout: 20_000 })
            .then((b) => (b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null))
            .catch(() => null);
        const fora = await aba('Buscar');
        if (!fora) {
          const rotulos = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[aria-label]'))
              .map((e) => e.getAttribute('aria-label'))
              .slice(0, 40),
          );
          throw new Error(
            `aba Buscar não achada; rótulos: ${JSON.stringify(rotulos)} url ${page.url()}`,
          );
        }
        await page.touchscreen.tap(fora.x, fora.y);
        await esperarDePe(page, '/search');
        await page.waitForTimeout(1_500);

        const inicio = await aba('Início');
        if (!inicio) throw new Error('aba Início não achada');
        const marca = await page.evaluate(() => performance.now());
        await page.touchscreen.tap(inicio.x, inicio.y);
        const ms = await esperarDePe(page, '/');
        const s = await lerSonda(page);
        const lts = s.longtasks.filter((t) => t.s >= marca);
        gravar('biblioteca', {
          cenario: 'voltar-home',
          rotulo: ROTULO,
          rep,
          volta,
          cpu: CPU_PADRAO,
          ms: Math.round(ms),
          nLongTasks: lts.length,
          tbt: tbt(lts, marca, Infinity),
          piorTarefa: Math.round(Math.max(0, ...lts.map((t) => t.d))),
        });
        await page.waitForTimeout(1_500);
      }
      await ctx.close();
    }
  });
});
