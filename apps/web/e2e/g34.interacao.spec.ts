/// <reference lib="dom" />
/**
 * INTERAÇÃO NO MOTO G34 — navegação, fluidez, INP, som e custo de fundo.
 *
 *  nav      clique/toque → conteúdo pintado, e tarefas longas no trajeto
 *  fluidez  rolagem (listas e carrosséis), abrir/fechar player e letra:
 *           quadros (rAF) acima de 18 ms / 33 ms, tarefas longas
 *  inp      tempo de resposta (Event Timing) dos toques principais
 *  som      toque no play → som saindo; troca de faixa
 *  fundo    CPU com música tocando e tela parada: tarefa/s, rAF/s, timers/s
 *
 * Estado de partida de todos: app "quente" (service worker + acervo no
 * IndexedDB), CPU já estrangulada durante o assentamento — é o que o G34 vive.
 */
import { test, type Locator, type Page } from '@playwright/test';
import { CPU_PADRAO, estrangular, novoContextoG34, prepararVisitante } from './motoG34';
import { gravar, instalarSonda, lerSonda, memoriaEDom, mediana } from './g34Medicao';
import {
  tapar,
  ALVO,
  abrirApp,
  agora,
  marcarCartao,
  pontoDe,
  pontoDoLink,
  rolar,
} from './g34Cenarios';

const REPS = Number(process.env.G34_REPS ?? 3);
const GRUPO = process.env.G34_GRUPO ?? 'tudo';
const quer = (g: string): boolean => GRUPO === 'tudo' || GRUPO === g;

// ── medidas por gesto ───────────────────────────────────────────────────────

/** Toca e devolve o pior Event Timing do gesto (0 = abaixo do limiar de 16 ms). */
async function tocar(
  page: Page,
  alvo: Locator,
  espera = 700,
): Promise<{ inp: number; atraso: number; longas: number; bloqueio: number }> {
  const marca = await agora(page);
  await tapar(page, alvo);
  await page.waitForTimeout(espera);
  const s = await lerSonda(page);
  const ev = s.eventos.filter(
    (e) => e.s >= marca - 2 && (e.id > 0 || /pointerup|click|keydown/.test(e.n)),
  );
  const lts = s.longtasks.filter((t) => t.s >= marca);
  return {
    inp: Math.max(0, ...ev.map((e) => e.d)),
    atraso: Math.max(0, ...ev.map((e) => e.atraso)),
    longas: lts.length,
    bloqueio: Math.round(lts.reduce((a, t) => a + Math.max(0, t.d - 50), 0)),
  };
}

/** Quadros: % acima de 18 ms (perdeu o vsync de 60 Hz), % acima de 33 ms. */
function estatQuadros(q: number[]): Record<string, number> {
  const n = Math.max(1, q.length);
  const ord = [...q].sort((a, b) => a - b);
  return {
    quadros: q.length,
    acima18: Math.round((q.filter((d) => d > 18).length / n) * 1000) / 10,
    acima33: Math.round((q.filter((d) => d > 33).length / n) * 1000) / 10,
    p95: Math.round(ord[Math.floor(n * 0.95)] ?? 0),
    max: Math.round(ord[ord.length - 1] ?? 0),
  };
}

async function comQuadros<T>(
  page: Page,
  corpo: () => Promise<T>,
): Promise<{ r: T; q: number[]; lts: { s: number; d: number }[]; loaf: number }> {
  const t0 = await agora(page);
  await page.evaluate(() =>
    (window as unknown as { __g34: { iniciarQuadros: () => void } }).__g34.iniciarQuadros(),
  );
  const r = await corpo();
  const q = await page.evaluate(() =>
    (window as unknown as { __g34: { pararQuadros: () => number[] } }).__g34.pararQuadros(),
  );
  const s = await lerSonda(page);
  return {
    r,
    q,
    lts: s.longtasks.filter((t) => t.s >= t0),
    loaf: s.loaf.filter((l) => l.s >= t0).length,
  };
}

/** Diferença de um contador entre duas leituras. */
const d = (x: Record<string, number>, y: Record<string, number>, k: string): number =>
  (x[k] ?? 0) - (y[k] ?? 0);

const blq = (l: { s: number; d: number }[]): number =>
  Math.round(l.reduce((a, t) => a + Math.max(0, t.d - 50), 0));

// ── nav ─────────────────────────────────────────────────────────────────────
/** Instala captura do toque e espera a página nova "de pé" (URL trocou, sem esqueleto, 2 quadros). */
async function esperarDePe(page: Page, deHref: string, teto = 20_000): Promise<number> {
  return page.evaluate(
    ({ de, teto }) =>
      new Promise<number>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t0 = (window as any).__toque || performance.now();
        const checar = (): void => {
          const mudou = location.pathname + location.search !== de;
          const semEsq =
            !document.querySelector('main .skeleton') && !!document.querySelector('main');
          if (mudou && semEsq) {
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
    { de: deHref, teto },
  );
}

type Ponto = { x: number; y: number } | null;

async function salto(
  page: Page,
  nome: string,
  ponto: () => Promise<Ponto>,
  rep: number,
  cpu: number,
): Promise<void> {
  const de = await page.evaluate(() => location.pathname + location.search);
  const p = await ponto();
  if (!p) return;
  const marca = await agora(page);
  await page.touchscreen.tap(p.x, p.y);
  const ms = await esperarDePe(page, de);
  const s = await lerSonda(page);
  const lts = s.longtasks.filter((t) => t.s >= marca);
  const ev = s.eventos.filter((e) => e.s >= marca - 2);
  gravar('nav', {
    cenario: nome,
    rep,
    cpu,
    ms: Math.round(ms),
    tarefasLongas: lts.length,
    tbt: blq(lts),
    piorTarefa: Math.round(Math.max(0, ...lts.map((t) => t.d))),
    inp: Math.max(0, ...ev.map((e) => e.d)),
  });
  await page.waitForTimeout(700);
}

test.describe('interação no G34', () => {
  test('nav — navegação entre rotas', async ({ browser }) => {
    test.skip(!quer('nav'));
    for (let rep = 1; rep <= REPS; rep++) {
      const { page, fechar } = await abrirApp(browser);
      const aba = (nome: string) => (): Promise<Ponto> =>
        pontoDe(page.locator('[aria-label="Navegação"] a', { hasText: nome }));
      // Abas inferiores.
      await salto(page, 'home → buscar (aba)', aba('Buscar'), rep, CPU_PADRAO);
      await salto(page, 'buscar → biblioteca (aba)', aba('Biblioteca'), rep, CPU_PADRAO);
      await salto(page, 'biblioteca → início (aba)', aba('Início'), rep, CPU_PADRAO);
      // Cartões da Home e volta.
      for (const [nome, href] of [
        ['home → artista', '/artista/'],
        ['home → gênero', '/genero/'],
        ['home → mix', '/mix/'],
        ['home → curtidas', '/liked'],
        ['home → histórico', '/history'],
        ['home → disco', '/disco/'],
      ] as const) {
        await salto(page, nome, () => pontoDoLink(page, href), rep, CPU_PADRAO);
        await salto(
          page,
          `${(nome.split('→')[1] ?? '').trim()} → início (aba)`,
          aba('Início'),
          rep,
          CPU_PADRAO,
        );
      }
      // "Mais" → configurações.
      await tapar(page, page.locator('button[aria-label="Mais"]:visible'));
      await page.waitForTimeout(600);
      await salto(
        page,
        'mais → configurações',
        () => pontoDe(page.locator('a[href="/settings"]').last()),
        rep,
        CPU_PADRAO,
      );
      await fechar();
    }
  });

  // ── fluidez ───────────────────────────────────────────────────────────────
  test('fluidez — rolagem de listas e carrosséis', async ({ browser }) => {
    test.skip(!quer('fluidez'));
    const paginas = [
      '/',
      '/library',
      '/liked',
      '/history',
      '/artista/Ice%20Cube',
      '/genero/Pop',
      '/mix/genre%3APop',
      '/search?q=a',
      '/artistas',
    ];
    for (let rep = 1; rep <= REPS; rep++) {
      const { page, cdp, fechar } = await abrirApp(browser);
      for (const url of paginas) {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(4_500);
        const m = await comQuadros(page, async () => {
          for (let i = 0; i < 5; i++) await rolar(cdp, -1400);
          for (let i = 0; i < 2; i++) await rolar(cdp, 1400);
        });
        gravar('fluidez', {
          cenario: `rolagem ${url}`,
          rep,
          ...estatQuadros(m.q),
          tarefasLongas: m.lts.length,
          tbt: blq(m.lts),
          loaf: m.loaf,
          ...(await memoriaEDom(page)),
        });
      }
      // Carrosséis horizontais da Home.
      await page.goto('/', { waitUntil: 'load' });
      await page.waitForTimeout(4_500);
      const alvos = await page.evaluate(() => {
        const out: { x: number; y: number }[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const cs = getComputedStyle(el);
          if (
            (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
            el.scrollWidth > el.clientWidth + 40 &&
            out.length < 3
          ) {
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }
        }
        return out;
      });
      await page.waitForTimeout(500);
      const m = await comQuadros(page, async () => {
        for (const a of alvos) {
          for (let i = 0; i < 3; i++) {
            await cdp.send('Input.synthesizeScrollGesture', {
              x: a.x,
              y: a.y,
              xDistance: -500,
              yDistance: 0,
              speed: 1800,
              gestureSourceType: 'touch',
            });
          }
        }
      });
      gravar('fluidez', {
        cenario: 'carrosséis da home (swipe horizontal)',
        rep,
        carrosseis: alvos.length,
        ...estatQuadros(m.q),
        tarefasLongas: m.lts.length,
        tbt: blq(m.lts),
        loaf: m.loaf,
      });
      await fechar();
    }
  });

  // ── player expandido, letra, INP e som ────────────────────────────────────
  test('inp — toques principais, player e letra', async ({ browser }) => {
    test.skip(!quer('inp'));
    for (let rep = 1; rep <= REPS; rep++) {
      const { page, cdp, fechar } = await abrirApp(browser);
      const reg = async (cenario: string, r: Record<string, unknown>): Promise<void> =>
        gravar('inp', { cenario, rep, ...r });

      await marcarCartao(page, 0);
      const play = page.locator(ALVO);
      await reg('toque no play (1ª faixa)', await tocar(page, play, 2_500));
      await page.waitForTimeout(3_000);
      await reg(
        'próxima (mini player)',
        await tocar(page, page.locator('button[aria-label="Próxima"]:visible').first(), 1_500),
      );
      const curtir = page.locator('button[aria-label="Curtir"]:visible').first();
      if (await curtir.count()) await reg('curtir', await tocar(page, curtir));
      await reg(
        'pausar',
        await tocar(page, page.locator('button[aria-label^="Pausar"]:visible').last()),
      );

      // Player expandido: abrir (spring + capa + visualizadores) e fechar.
      const abrir = page.locator('button[aria-label="Abrir reprodução em tela cheia"]:visible');
      const m1 = await comQuadros(page, async () => {
        const r = await tocar(page, abrir, 1_200);
        await page
          .locator('[aria-label="Tocando agora"]:visible')
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined);
        await page.waitForTimeout(1_000);
        return r;
      });
      await reg('abrir player expandido', {
        ...m1.r,
        ...estatQuadros(m1.q),
        tbt: blq(m1.lts),
        loaf: m1.loaf,
      });

      // Letra dentro do player (karaokê com a música tocando).
      const letra = page.locator('button[aria-label="Letra"]:visible');
      if (await letra.count()) {
        const m2 = await comQuadros(page, async () => {
          const r = await tocar(page, letra, 3_000);
          await page.waitForTimeout(6_000); // karaokê rolando
          return r;
        });
        await reg('abrir letra + 6 s de karaokê', {
          ...m2.r,
          ...estatQuadros(m2.q),
          tbt: blq(m2.lts),
          loaf: m2.loaf,
          ...(await memoriaEDom(page)),
        });
      } else {
        await reg('abrir letra (botão não encontrado)', { inp: -1 });
      }
      const fechar1 = page.locator('button[aria-label="Fechar"]:visible').first();
      const m3 = await comQuadros(page, async () => tocar(page, fechar1, 1_500));
      await reg('fechar player expandido', {
        ...m3.r,
        ...estatQuadros(m3.q),
        tbt: blq(m3.lts),
        loaf: m3.loaf,
      });

      // Busca: abrir e digitar.
      await reg(
        'abrir busca (aba)',
        await tocar(page, page.locator('[aria-label="Navegação"] a', { hasText: 'Buscar' }), 1_500),
      );
      const campo = page.getByPlaceholder('O que vamos ouvir?').first();
      await tapar(page, campo);
      await page.waitForTimeout(600);
      const marca = await agora(page);
      const m4 = await comQuadros(page, async () => {
        for (const ch of 'ice cube') {
          await page.keyboard.type(ch, { delay: 0 });
          await page.waitForTimeout(140); // ritmo de digitação de celular
        }
        await page.waitForTimeout(1_500);
      });
      const s = await lerSonda(page);
      const teclas = s.eventos.filter(
        (e) => e.s >= marca && /keydown|keypress|input|keyup/.test(e.n),
      );
      await reg('digitar "ice cube" na busca', {
        inp: Math.max(0, ...teclas.map((e) => e.d)),
        ...estatQuadros(m4.q),
        tbt: blq(m4.lts),
        tarefasLongas: m4.lts.length,
        loaf: m4.loaf,
      });
      void cdp;
      await fechar();
    }
  });

  /**
   * PRIMEIRO USO — a "revisão única de gêneros" (genreAgent.ts → revisarGeneros)
   * ainda não rodou, como em toda instalação nova ou dado limpo. Mede quanto
   * tempo a thread principal fica presa e quando a revisão termina.
   */
  test('primeiro — primeiro uso, com a revisão de gêneros pendente', async ({ browser }) => {
    test.skip(!quer('primeiro'));
    test.setTimeout(30 * 60_000);
    for (let rep = 1; rep <= Math.min(REPS, 2); rep++) {
      const ctx = await novoContextoG34(browser);
      await prepararVisitante(ctx, { revisaoDeGeneroFeita: false });
      await ctx.addInitScript(instalarSonda);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await estrangular(cdp, CPU_PADRAO, '4g');
      const t0 = Date.now();
      await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
      const fim = await page
        .waitForFunction(() => localStorage.getItem('aurial:genreRevisao') === '1', null, {
          timeout: 25 * 60_000,
          polling: 2_000,
        })
        .then(() => Date.now() - t0)
        .catch(() => -1);
      const s = await lerSonda(page);
      const grandes = s.longtasks.filter((t) => t.d > 1_000);
      gravar('primeiro', {
        cenario: 'primeiro uso: revisão de gêneros (5,7 mil faixas)',
        rep,
        cpu: CPU_PADRAO,
        msAteTerminar: fim,
        tbt: blq(s.longtasks),
        maiorTarefaMs: Math.round(Math.max(0, ...s.longtasks.map((t) => t.d))),
        tarefasAcimaDe1s: grandes.length,
      });
      await ctx.close();
    }
  });

  test('som — do toque no play até o som e troca de faixa', async ({ browser }) => {
    test.skip(!quer('som'));
    const { page, fechar } = await abrirApp(browser);
    const total = 8;
    for (let i = 0; i < total; i++) {
      await page.evaluate(() => {
        (window as unknown as { __som: unknown }).__som = { t: 0, src: '' };
      });
      if (!(await marcarCartao(page, i))) break;
      await tapar(page, page.locator(ALVO));
      const ok = await page
        .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
          timeout: 30_000,
        })
        .then(() => true)
        .catch(() => false);
      const r = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return { som: w.__som.t, toque: w.__toque, src: String(w.__som.src).slice(0, 60) };
      });
      gravar('som', {
        cenario: 'toque no play → som (faixa nova)',
        rep: i + 1,
        ms: ok ? Math.round(r.som - r.toque) : -1,
        src: r.src,
      });
      await page.waitForTimeout(1_500);
    }
    // Troca de faixa pelo "Próxima".
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        (window as unknown as { __som: unknown }).__som = { t: 0, src: '' };
      });
      await tapar(page, page.locator('button[aria-label="Próxima"]:visible').first());
      const ok = await page
        .waitForFunction(() => (window as unknown as { __som: { t: number } }).__som.t > 0, null, {
          timeout: 30_000,
        })
        .then(() => true)
        .catch(() => false);
      const r = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return { som: w.__som.t, toque: w.__toque };
      });
      gravar('som', {
        cenario: 'próxima → som (troca de faixa)',
        rep: i + 1,
        ms: ok ? Math.round(r.som - r.toque) : -1,
      });
      await page.waitForTimeout(2_000);
    }
    await fechar();
  });

  // ── fundo ─────────────────────────────────────────────────────────────────
  test('fundo — CPU com música tocando e a tela parada', async ({ browser }) => {
    test.skip(!quer('fundo'));
    for (const variante of [
      'home parada tocando',
      'player expandido tocando',
      'player expandido + letra',
    ]) {
      for (let rep = 1; rep <= Math.min(REPS, 3); rep++) {
        const { page, cdp, fechar } = await abrirApp(browser);
        await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = window as any;
          w.__fundo = { raf: 0, timeouts: 0, intervals: 0, muts: 0 };
          const raf = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => {
            w.__fundo.raf++;
            return raf(cb);
          };
          const st = window.setTimeout.bind(window) as typeof window.setTimeout;
          // @ts-expect-error contador de timers
          window.setTimeout = (...a: Parameters<typeof setTimeout>) => {
            w.__fundo.timeouts++;
            return st(...a);
          };
          const si = window.setInterval.bind(window) as typeof window.setInterval;
          // @ts-expect-error contador de timers
          window.setInterval = (...a: Parameters<typeof setInterval>) => {
            w.__fundo.intervals++;
            return si(...a);
          };
          new MutationObserver((l) => {
            w.__fundo.muts += l.length;
          }).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        });
        await marcarCartao(page, 0);
        await tapar(page, page.locator(ALVO));
        await page
          .waitForFunction(
            () => (window as unknown as { __som: { t: number } }).__som.t > 0,
            null,
            { timeout: 30_000 },
          )
          .catch(() => undefined);
        if (variante !== 'home parada tocando') {
          await tapar(
            page,
            page.locator('button[aria-label="Abrir reprodução em tela cheia"]:visible'),
          );
          await page.waitForTimeout(1_500);
        }
        if (variante === 'player expandido + letra') {
          await tapar(page, page.locator('button[aria-label="Letra"]:visible')).catch(
            () => undefined,
          );
          await page.waitForTimeout(2_000);
        }
        await page.waitForTimeout(3_000);
        const metrica = async (): Promise<Record<string, number>> => {
          const r = (await cdp.send('Performance.getMetrics')) as {
            metrics: { name: string; value: number }[];
          };
          return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
        };
        await cdp.send('Performance.enable');
        const a = await metrica();
        const f0 = await page.evaluate(() => ({
          ...(window as unknown as { __fundo: Record<string, number> }).__fundo,
        }));
        const t0 = await agora(page);
        const JANELA = 30_000;
        await page.waitForTimeout(JANELA);
        const b = await metrica();
        const f1 = await page.evaluate(() => ({
          ...(window as unknown as { __fundo: Record<string, number> }).__fundo,
        }));
        const s = await lerSonda(page);
        const lts = s.longtasks.filter((t) => t.s >= t0);
        const seg = d(b, a, 'Timestamp') || JANELA / 1000;
        gravar('fundo', {
          cenario: variante,
          rep,
          cpuPct: Math.round((d(b, a, 'TaskDuration') / seg) * 1000) / 10,
          scriptPct: Math.round((d(b, a, 'ScriptDuration') / seg) * 1000) / 10,
          layoutPct: Math.round((d(b, a, 'LayoutDuration') / seg) * 1000) / 10,
          estiloPct: Math.round((d(b, a, 'RecalcStyleDuration') / seg) * 1000) / 10,
          layoutsPorSeg: Math.round((d(b, a, 'LayoutCount') / seg) * 10) / 10,
          estilosPorSeg: Math.round((d(b, a, 'RecalcStyleCount') / seg) * 10) / 10,
          rafPorSeg: Math.round(d(f1, f0, 'raf') / seg),
          timeoutsPorSeg: Math.round((d(f1, f0, 'timeouts') / seg) * 10) / 10,
          intervalosPorSeg: Math.round((d(f1, f0, 'intervals') / seg) * 10) / 10,
          mutacoesPorSeg: Math.round((d(f1, f0, 'muts') / seg) * 10) / 10,
          tarefasLongas: lts.length,
          tbt: blq(lts),
          ...(await memoriaEDom(page)),
        });
        await fechar();
      }
    }
    void mediana;
  });
});
