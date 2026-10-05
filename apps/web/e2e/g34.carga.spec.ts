/// <reference lib="dom" />
/**
 * CARGA FRIA E QUENTE — cada rota do app aberta por URL direta.
 *
 *  fria   contexto novo: sem cache HTTP, sem service worker, sem IndexedDB —
 *         é a primeira visita de quem chegou por um link.
 *  quente 2ª abertura NO MESMO contexto: service worker controlando, precache
 *         pronto, acervo já no IndexedDB — é o app de todo dia.
 *
 * Métricas: TTFB, FCP, LCP, "sem esqueleto" (conteúdo de fato na tela), TBT até
 * 6 s depois do `load`, última tarefa longa (proxy de "interativo"), CLS, bytes
 * e requisições, heap e nós de DOM. Mediana de G34_REPS (padrão 3).
 */
import { test, type Browser, type Page } from '@playwright/test';
import {
  CPU_PADRAO,
  CPU_PESSIMISTA,
  estrangular,
  novoContextoG34,
  prepararVisitante,
  type NomeRede,
} from './motoG34';
import { ColetorRede, gravar, instalarSonda, lerSonda, memoriaEDom, tbt } from './g34Medicao';

const REPS = Number(process.env.G34_REPS ?? 3);
const JANELA_MS = 6_000;
const GRUPO = process.env.G34_GRUPO ?? 'tudo';

/** Rotas reais do router (apps/web/src/app/router.tsx) com parâmetros tirados do acervo. */
export const ROTAS: { nome: string; url: string }[] = [
  { nome: 'home', url: '/' },
  { nome: 'busca (vazia)', url: '/search' },
  { nome: 'busca (q=ice)', url: '/search?q=ice' },
  { nome: 'biblioteca', url: '/library' },
  { nome: 'artistas', url: '/artistas' },
  { nome: 'gravadoras', url: '/gravadoras' },
  { nome: 'curtidas', url: '/liked' },
  { nome: 'histórico', url: '/history' },
  { nome: 'descobrir', url: '/discover' },
  { nome: 'artista (local)', url: '/artista/Ice%20Cube' },
  { nome: 'disco (local)', url: '/disco/the%20predator%7Cice%20cube' },
  { nome: 'gênero', url: '/genero/Pop' },
  { nome: 'mix (gênero)', url: '/mix/genre%3APop' },
  { nome: 'mix (artista)', url: '/mix/artist%3AIce%20Cube' },
  { nome: 'rádios', url: '/radios' },
  { nome: 'podcasts', url: '/podcasts' },
  { nome: 'configurações', url: '/settings' },
  { nome: 'compartilhar', url: '/compartilhar' },
  { nome: 'diagnóstico', url: '/diagnostico' },
  { nome: 'login', url: '/login' },
  { nome: 'onboarding', url: '/onboarding' },
  { nome: 'receber link', url: '/receber' },
  { nome: 'não encontrada', url: '/nao-existe' },
];

async function carregar(
  page: Page,
  coletor: ColetorRede,
  url: string,
): Promise<Record<string, unknown>> {
  coletor.zerar();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  const ateLoad = Date.now() - t0;
  const rede = coletor.resumo();
  await page.waitForTimeout(JANELA_MS);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  const s = await lerSonda(page);
  const fim = nav.load + JANELA_MS;
  const lts = s.longtasks.filter((t) => t.s <= fim);
  const mem = await memoriaEDom(page);
  const boot = await page.evaluate(() => {
    const f = (window as unknown as { radinhoPerfDados?: () => { etapas: Record<string, number> } })
      .radinhoPerfDados;
    return f?.().etapas ?? null;
  });
  const perf = await page.evaluate(() => ({
    perf: document.documentElement.dataset.perf ?? null,
    rede: document.documentElement.dataset.rede ?? null,
    mem: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    nuc: navigator.hardwareConcurrency,
    plat: (navigator as unknown as { userAgentData?: { platform: string } }).userAgentData
      ?.platform,
  }));
  return {
    perfil: perf,
    ttfb: Math.round(nav.ttfb),
    fcp: Math.round(s.fcp),
    lcp: Math.round(s.lcp),
    lcpTag: s.lcpTag,
    semEsqueleto: Math.round(s.semEsqueletoEm || s.fcp),
    load: Math.round(nav.load),
    tbt: tbt(lts, s.fcp, fim),
    ultimaTarefaLonga: lts.length ? Math.round((lts.at(-1)?.s ?? 0) + (lts.at(-1)?.d ?? 0)) : 0,
    nLongTasks: lts.length,
    piorTarefa: Math.round(Math.max(0, ...lts.map((t) => t.d))),
    cls: Math.round(s.cls * 1000) / 1000,
    redeAteLoad: rede,
    redeFinal: coletor.resumo(),
    scripts: coletor.scripts(),
    hosts: coletor.porHost(),
    ...mem,
    boot,
    wallAteLoad: ateLoad,
  };
}

async function rodada(
  browser: Browser,
  rota: { nome: string; url: string },
  cpu: number,
  rede: NomeRede,
  rep: number,
  rotulo: string,
  soFria = false,
): Promise<void> {
  const ctx = await novoContextoG34(browser);
  await prepararVisitante(ctx);
  await ctx.addInitScript(instalarSonda);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const coletor = new ColetorRede(cdp);
  await cdp.send('Network.enable');
  await estrangular(cdp, cpu, rede);

  const fria = await carregar(page, coletor, rota.url);
  gravar('carga', {
    rota: rota.nome,
    url: rota.url,
    estado: 'fria',
    cpu,
    rede,
    rep,
    rotulo,
    ...fria,
  });

  if (!soFria) {
    // Espera o service worker assumir (precache terminou) antes da 2ª abertura.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false);
    await page.waitForTimeout(2_500);
    const quente = await carregar(page, coletor, rota.url);
    const sw = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    gravar('carga', {
      rota: rota.nome,
      url: rota.url,
      estado: 'quente',
      cpu,
      rede,
      rep,
      rotulo,
      sw,
      ...quente,
    });
  }
  await ctx.close();
}

test.describe('carga fria e quente', () => {
  test.skip(GRUPO !== 'tudo' && GRUPO !== 'carga');

  test('home — variantes de perfil', async ({ browser }) => {
    const home = ROTAS[0]!;
    // Perfil principal (CPU calibrada + 4G) e as duas sensibilidades pedidas.
    for (let rep = 1; rep <= Math.max(REPS, 5); rep++)
      await rodada(browser, home, CPU_PADRAO, '4g', rep, 'principal');
    for (let rep = 1; rep <= REPS; rep++)
      await rodada(browser, home, CPU_PESSIMISTA, '4g', rep, 'cpu-4x');
    for (let rep = 1; rep <= REPS; rep++)
      await rodada(browser, home, CPU_PADRAO, '4g-ruim', rep, '4g-ruim');
  });

  test('todas as rotas — perfil principal', async ({ browser }) => {
    for (const rota of ROTAS.slice(1)) {
      for (let rep = 1; rep <= REPS; rep++)
        await rodada(browser, rota, CPU_PADRAO, '4g', rep, 'principal');
    }
  });
});
