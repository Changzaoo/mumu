/// <reference lib="dom" />
/**
 * PERFIL DE CPU (CDP Profiler) dos cenários mais pesados — serve para apontar
 * funções e arquivos. Roda contra um build COM source map (`dist-mapa`, ver
 * `G34_DIST` em g34Servidor.mjs) porque o `dist` de produção é minificado e sem
 * mapa. Grava `.g34/perfil-<cenário>-<n>.cpuprofile`; o
 * `g34Perfil.mjs` converte em tabela por arquivo:linha de `src/`.
 *
 *   G34_DIST=.g34/dist-mapa G34_GRUPO=perfil pnpm perf:g34
 *   G34_PERFIS=home-quente,biblioteca-rolagem,player-letra  (padrão: todos)
 */
import { test, type Browser, type CDPSession } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CPU_PADRAO, estrangular, novoContextoG34, prepararVisitante } from './motoG34';
import { instalarSonda, PASTA } from './g34Medicao';
import { tapar, ALVO, abrirApp, instalarSom, marcarCartao, rolar } from './g34Cenarios';

const GRUPO = process.env.G34_GRUPO ?? 'tudo';
const QUAIS = (
  process.env.G34_PERFIS ??
  'home-quente,home-fria,biblioteca-rolagem,player-letra,busca-digitar,navegacao,play-som,curtir,fundo,mix-rolagem,fundo-trace'
).split(',');

async function perfilar(cdp: CDPSession, nome: string, corpo: () => Promise<void>): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
  await corpo();
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: unknown };
  mkdirSync(PASTA, { recursive: true });
  writeFileSync(join(PASTA, `perfil-${nome}.cpuprofile`), JSON.stringify(profile));
}

async function aberturaComPerfil(browser: Browser, quente: boolean): Promise<void> {
  const ctx = await novoContextoG34(browser);
  await prepararVisitante(ctx);
  await ctx.addInitScript(instalarSonda);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await estrangular(cdp, CPU_PADRAO, '4g');
  if (quente) {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false);
    await page.waitForTimeout(2_500);
  }
  await perfilar(cdp, quente ? 'home-quente' : 'home-fria', async () => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(8_000);
  });
  await ctx.close();
}

test.describe('perfil de CPU', () => {
  test.skip(GRUPO !== 'tudo' && GRUPO !== 'perfil');

  test('home quente', async ({ browser }) => {
    test.skip(!QUAIS.includes('home-quente'));
    await aberturaComPerfil(browser, true);
  });
  test('home fria', async ({ browser }) => {
    test.skip(!QUAIS.includes('home-fria'));
    await aberturaComPerfil(browser, false);
  });

  test('biblioteca — rolagem', async ({ browser }) => {
    test.skip(!QUAIS.includes('biblioteca-rolagem'));
    const { page, cdp, fechar } = await abrirApp(browser, CPU_PADRAO, '/library');
    await page.waitForTimeout(3_000);
    await perfilar(cdp, 'biblioteca-rolagem', async () => {
      for (let i = 0; i < 8; i++) await rolar(cdp, -1400);
      for (let i = 0; i < 4; i++) await rolar(cdp, 1400);
    });
    await fechar();
  });

  test('player expandido + letra tocando', async ({ browser }) => {
    test.skip(!QUAIS.includes('player-letra'));
    const { page, cdp, fechar } = await abrirApp(browser);
    await marcarCartao(page, 0);
    await tapar(page, page.locator(ALVO));
    await page
      .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
        timeout: 30_000,
      })
      .catch(() => undefined);
    await perfilar(cdp, 'player-letra', async () => {
      await tapar(
        page,
        page.locator('button[aria-label="Abrir reprodução em tela cheia"]:visible'),
      );
      await page.waitForTimeout(1_500);
      await tapar(page, page.locator('button[aria-label="Letra"]:visible')).catch(() => undefined);
      await page.waitForTimeout(8_000);
      await tapar(page, page.locator('button[aria-label="Fechar"]:visible').first()).catch(
        () => undefined,
      );
      await page.waitForTimeout(1_500);
    });
    await fechar();
  });

  test('busca — digitar', async ({ browser }) => {
    test.skip(!QUAIS.includes('busca-digitar'));
    const { page, cdp, fechar } = await abrirApp(browser, CPU_PADRAO, '/search');
    await perfilar(cdp, 'busca-digitar', async () => {
      await tapar(page, page.getByPlaceholder('O que vamos ouvir?').first());
      for (const ch of 'ice cube snoop') {
        await page.keyboard.type(ch);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(2_000);
    });
    await fechar();
  });

  test('play → som e curtir', async ({ browser }) => {
    test.skip(!QUAIS.includes('play-som'));
    const { page, cdp, fechar } = await abrirApp(browser);
    await marcarCartao(page, 1);
    await perfilar(cdp, 'play-som', async () => {
      await tapar(page, page.locator(ALVO));
      await page
        .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
          timeout: 30_000,
        })
        .catch(() => undefined);
      await page.waitForTimeout(6_000);
    });
    await page.waitForTimeout(3_000);
    await perfilar(cdp, 'curtir', async () => {
      await tapar(page, page.locator('button[aria-label="Curtir"]:visible').first());
      await page.waitForTimeout(2_500);
    });
    await fechar();
  });

  test('fundo — música tocando, tela parada', async ({ browser }) => {
    test.skip(!QUAIS.includes('fundo'));
    const { page, cdp, fechar } = await abrirApp(browser);
    await marcarCartao(page, 1);
    await tapar(page, page.locator(ALVO));
    await page
      .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
        timeout: 30_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(4_000);
    await perfilar(cdp, 'fundo', async () => {
      await page.waitForTimeout(20_000);
    });
    await fechar();
  });

  /**
   * O `(program)` do perfil de CPU é tudo que não é JavaScript (estilo, layout,
   * pintura, raster, composição). Este trace o abre: tempo da thread principal por
   * tipo de evento, com a música tocando e a tela parada.
   */
  test('fundo — trace da thread principal', async ({ browser }) => {
    test.skip(!QUAIS.includes('fundo-trace'));
    const { page, cdp, fechar } = await abrirApp(browser);
    await marcarCartao(page, 1);
    await tapar(page, page.locator(ALVO));
    await page
      .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
        timeout: 30_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(4_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventos: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Tracing.dataCollected', (e: any) => eventos.push(...e.value));
    const fim = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
    await cdp.send('Tracing.start', {
      traceConfig: {
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'blink.user_timing',
          'cc',
        ],
      },
    });
    await page.waitForTimeout(15_000);
    await cdp.send('Tracing.end');
    await fim;
    const principal = eventos.find(
      (e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
    );
    const soma: Record<string, { ms: number; n: number }> = {};
    for (const e of eventos) {
      if (e.ph !== 'X' || !principal || e.tid !== principal.tid || e.pid !== principal.pid)
        continue;
      const s = (soma[e.name] ??= { ms: 0, n: 0 });
      s.ms += (e.dur ?? 0) / 1000;
      s.n += 1;
    }
    writeFileSync(
      join(PASTA, 'trace-fundo.json'),
      JSON.stringify(
        Object.fromEntries(
          Object.entries(soma)
            .sort((a, b) => b[1].ms - a[1].ms)
            .slice(0, 40),
        ),
        null,
        1,
      ),
    );
    await fechar();
  });

  test('mix (gênero) — abrir e rolar', async ({ browser }) => {
    test.skip(!QUAIS.includes('mix-rolagem'));
    const { page, cdp, fechar } = await abrirApp(browser, CPU_PADRAO, '/library');
    await perfilar(cdp, 'mix-rolagem', async () => {
      await page.goto('/mix/genre%3APop', { waitUntil: 'load' });
      await page.waitForTimeout(5_000);
      for (let i = 0; i < 4; i++) await rolar(cdp, -1400);
    });
    await fechar();
  });

  test('navegação entre rotas', async ({ browser }) => {
    test.skip(!QUAIS.includes('navegacao'));
    const { page, cdp, fechar } = await abrirApp(browser);
    const aba = (n: string) => page.locator('[aria-label="Navegação"] a', { hasText: n });
    await perfilar(cdp, 'navegacao', async () => {
      for (const n of ['Buscar', 'Biblioteca', 'Início', 'Buscar', 'Biblioteca', 'Início']) {
        await tapar(page, aba(n));
        await page.waitForTimeout(1_800);
      }
    });
    await fechar();
  });
});
void instalarSom;
