/**
 * PERFIL DO MOTO G34 5G — um módulo só, reaproveitado por todo o arnês `perf:g34`.
 *
 * Aparelho: Motorola moto g34 5G (Android 14), Snapdragon 695 (2x A78 @2,2 GHz +
 * 6x A55), 4 GB de RAM, tela 6,5" 720x1600 a 120 Hz, DPR 2 (viewport CSS 360x800).
 *
 * ── A TAXA DE CPU, E POR QUE NÃO É 4× ──
 *
 * `Emulation.setCPUThrottlingRate` é relativo à máquina que mede, então a taxa
 * certa depende DELA. O padrão de 4× do Lighthouse supõe um desktop moderno
 * (Geekbench 6 monocore ~2500-3000) contra um celular de ~500-700. Esta máquina é
 * um i5-4590 (Haswell, 2014):
 *
 *   Geekbench 6 single-core, i5-4590 ........... ~1077-1137  (browser.geekbench.com)
 *   Geekbench 6 single-core, moto g34 5G ....... ~855-918    (browser.geekbench.com)
 *
 * Razão nativa ~1,25×. O Chrome de Android entrega menos JS por ponto de
 * Geekbench que o de desktop (cache pequeno, A55 pegando trabalho de fundo,
 * térmica) — fator que NÃO foi medido aqui e é estimativa nossa de ~2×.
 * Resultado: 2,5× como perfil principal. O 4× padrão do Lighthouse roda como
 * perfil PESSIMISTA nas cargas, para dar a faixa. `G34_CPU=<n>` sobrescreve.
 * `calibrarCpu` roda um micro-benchmark fixo e grava a relação taxa → ops/s, para
 * o relatório poder mostrar que a emulação está efetivamente mais lenta.
 */
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';

export const G34 = {
  nome: 'moto g34 5G',
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; moto g34 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  /** RAM do aparelho — só registro, o heap/DOM é o que medimos. */
  ramGb: 4,
} as const;

export const CPU_PADRAO = Number(process.env.G34_CPU ?? 2.5);
export const CPU_PESSIMISTA = 4;

export interface Rede {
  nome: string;
  /** Mbps */
  down: number;
  up: number;
  /** ms de ida e volta */
  latencia: number;
}

export const REDES = {
  '4g': { nome: '4G BR', down: 10, up: 3, latencia: 60 },
  '4g-ruim': { nome: '4G ruim', down: 1.6, up: 0.75, latencia: 150 },
} satisfies Record<string, Rede>;
export type NomeRede = keyof typeof REDES;

/**
 * Hosts de capa redirecionados ao servidor local HTTPS (porta 4443) e TODO o
 * resto da internet recusado na hora (determinístico, como `isolarDaRede`).
 * Firebase, Google, importer etc. falham rápido — o app trata como offline.
 */
export const ARGS_CHROMIUM = [
  '--host-resolver-rules=' +
    [
      'MAP i.ytimg.com 127.0.0.1:4443',
      'MAP *.ytimg.com 127.0.0.1:4443',
      'MAP *.mzstatic.com 127.0.0.1:4443',
      'MAP *.dzcdn.net 127.0.0.1:4443',
      'MAP *.googleusercontent.com 127.0.0.1:4443',
      'MAP *.nexusholding.xyz 127.0.0.1:4443',
      'MAP itunes.apple.com 127.0.0.1:4443',
      'MAP lrclib.net 127.0.0.1:4443',
      'MAP * ~NOTFOUND',
      'EXCLUDE localhost',
      'EXCLUDE 127.0.0.1',
    ].join(','),
  '--ignore-certificate-errors',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
  '--autoplay-policy=no-user-gesture-required',
  // Sem o throttling de aba em segundo plano e sem janela escondida: a medição
  // roda numa janela só, sempre em primeiro plano.
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
];

export const ORIGEM = `http://localhost:${process.env.G34_PORTA ?? 4180}`;

/** Contexto Playwright com tela, UA e toque do G34. */
export async function novoContextoG34(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: ORIGEM,
    viewport: G34.viewport,
    deviceScaleFactor: G34.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: G34.userAgent,
    locale: 'pt-BR',
    ignoreHTTPSErrors: true,
  });
}

/** Aplica CPU e rede à página (e ao service worker, quando já existir). */
export async function estrangular(
  cdp: CDPSession,
  cpu: number,
  rede: NomeRede | null,
): Promise<void> {
  // `userAgentData.platform` = 'Android' (o app consulta isto antes do UA).
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: G34.userAgent,
    userAgentMetadata: {
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: '',
      model: 'moto g34 5G',
      mobile: true,
      brands: [
        { brand: 'Chromium', version: '130' },
        { brand: 'Google Chrome', version: '130' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '130.0.0.0' },
        { brand: 'Google Chrome', version: '130.0.0.0' },
      ],
    },
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Network.enable');
  const r = rede ? REDES[rede] : null;
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: r?.latencia ?? 0,
    downloadThroughput: r ? (r.down * 1024 * 1024) / 8 : -1,
    uploadThroughput: r ? (r.up * 1024 * 1024) / 8 : -1,
  });
}

/**
 * Visitante já passou pelas perguntas de primeira visita (idade, onboarding,
 * convite do APK) — é o que mede o app e não o diálogo. Mesmo truque da sonda
 * `tempoAteOSom.probe.mjs`.
 */
export async function prepararVisitante(
  context: BrowserContext,
  { revisaoDeGeneroFeita = true }: { revisaoDeGeneroFeita?: boolean } = {},
): Promise<void> {
  // IDENTIDADE DO APARELHO. O app decide o perfil de efeitos pelo hardware que o
  // navegador conta (lib/perf/dispositivo.ts): Android com <= 4 GB vira
  // `data-perf="baixo"` — sem vidro, plantões atrasados, aquecimento de rotas
  // desligado. Um Chromium de desktop diria 8 GB e 4 núcleos e o arnês mediria
  // OUTRO app. O G34 de 4 GB reporta `deviceMemory = 4` e 8 núcleos (SD695).
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: () => 4,
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
    });
  });
  await context.addInitScript((feita: boolean) => {
    try {
      // USUÁRIO RECORRENTE: a "revisão única de gêneros" (genreAgent.ts,
      // REVISAO_KEY) já terminou numa sessão anterior. Sem esta marca, TODA
      // sessão nova do arnês dispara um trabalho O(N²) de ~2 minutos na thread
      // principal (medido: 147 s a 2,5×) que contamina qualquer outra medição.
      // Esse custo é medido à parte, no grupo `primeiro`.
      if (feita) localStorage.setItem('aurial:genreRevisao', '1');
      const ajustes = JSON.parse(localStorage.getItem('aurial:settings') || '{"state":{}}');
      ajustes.state = {
        ...ajustes.state,
        dataNascimento: ajustes.state?.dataNascimento || '1990-01',
      };
      localStorage.setItem('aurial:settings', JSON.stringify(ajustes));
      if (!localStorage.getItem('aurial:gosto-inicial')) {
        localStorage.setItem('aurial:gosto-inicial', JSON.stringify({ generos: [], artistas: [] }));
      }
      localStorage.setItem('aurial:apk-dispensado-em', String(Date.now()));
    } catch {
      /* sem storage */
    }
  }, revisaoDeGeneroFeita);
}

/** Micro-benchmark JS fixo (ops/ms): laço numérico + alocação + Map. */
export async function benchmarkJs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t0 = performance.now();
    let acc = 0;
    const m = new Map<number, number[]>();
    for (let i = 0; i < 400_000; i++) {
      acc += Math.sqrt(i) * Math.sin(i);
      if (i % 8 === 0) m.set(i, [i, i + 1, i + 2]);
    }
    const arr = Array.from({ length: 150_000 }, (_, i) => ({ id: i, s: `faixa ${i}` }));
    arr.sort((a, b) => (a.s < b.s ? -1 : 1));
    const dt = performance.now() - t0;
    return Math.round(((400_000 + 150_000) / dt) * 10) / 10 + (acc > 1e99 ? 1 : 0);
  });
}
