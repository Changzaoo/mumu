/// <reference lib="dom" />
/**
 * FIM NATURAL NO CAMINHO REMOTO — a seguinte (faixa do acervo, sem cópia no
 * aparelho, endereço do cofre vindo de `GET /catalogo/:id`) tem que TOCAR, e não
 * só trocar o título, quando a faixa de agora acaba sozinha.
 *
 * Regressão de produção: a seguinte é resolvida e PRÉ-CARREGADA no slot ocioso
 * a partir de 5 s; o fim natural a promove. O e2e de faixas locais passava (outro
 * ramo do `loadIndex`) e o defeito só existia aqui.
 *
 * O áudio do `/blob/` vira um recorte de 12 s do tom do servidor de mentira:
 * visitante sem login só ouve 30 s por faixa (`firePreviewGate`), então um seek
 * para o fim de uma faixa de 3 min pararia o player por outro motivo. Com 12 s o
 * fim chega sozinho, depois dos 5 s da pré-carga e antes do portão.
 *
 *   pnpm exec playwright test --config playwright.g34.config.ts g34.fimnatural
 */
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { abrirApp, marcarCartao, ALVO, ASSENTAR_MS } from './g34Cenarios';
import { ORIGEM, prepararVisitante } from './motoG34';
import { instalarSonda } from './g34Medicao';

const DURACAO_S = Number(process.env.G34_DURACAO_S ?? 12);
/** Atraso do cofre de mentira por pedido (ms): rede de verdade não responde em 0. */
const PERFIL = process.env.G34_PERFIL ?? 'desktop';
const abrir = (browser: Browser) =>
  PERFIL === 'moto' ? abrirApp(browser, 1) : abrirDesktop(browser);
const CRUZAR_ORIGEM = process.env.G34_MESMA_ORIGEM !== '1';
const ATRASO_DO_COFRE_MS = Number(process.env.G34_COFRE_MS ?? 150);

function gerarRecorte(duracaoS = DURACAO_S): Buffer {
  const pasta = join(tmpdir(), 'radinho-g34');
  mkdirSync(pasta, { recursive: true });
  const saida = join(pasta, `curta-${duracaoS}.mp3`);
  if (!existsSync(saida)) {
    const tom = join(process.cwd(), '.g34', 'fixtures', 'tom.mp3');
    execFileSync('ffmpeg', ['-y', '-i', tom, '-t', String(duracaoS), '-c', 'copy', saida], {
      stdio: 'ignore',
    });
  }
  return readFileSync(saida);
}

/** Serve o recorte em `/blob/**` com Range (o <audio> pede por faixas de bytes). */
async function cofreCurto(
  page: Page,
  corpo: Buffer,
  pedidos: string[],
  falhasNaPreCarga = 0,
): Promise<void> {
  // O cofre de verdade mora em OUTRA origem que o app (CORS, grafo Web Audio,
  // `crossOrigin` do elemento só importam assim). O servidor de mentira devolve
  // `localhost`, a mesma origem do app: troca por `127.0.0.1`, que é outra para
  // o navegador e a mesma máquina para nós.
  if (CRUZAR_ORIGEM) {
    await page.route('**/api/v1/catalogo/**', async (route) => {
      const resposta = await route.fetch();
      const texto = (await resposta.text()).replace(
        /http:\/\/localhost:(\d+)\/blob\//g,
        'http://127.0.0.1:$1/blob/',
      );
      await route.fulfill({ response: resposta, body: texto });
    });
  }
  let primeiroId = '';
  const ids: string[] = [];
  const falhas = new Map<string, number>();
  await page.route('**/blob/**', async (route) => {
    const req = route.request();
    pedidos.push(decodeURIComponent(new URL(req.url()).pathname.slice(-12)));
    const id = pedidos[pedidos.length - 1] ?? '';
    if (!primeiroId) primeiroId = id;
    const ehPreCarga = id !== primeiroId;
    // Cofre hostil, só para a pré-carga (a faixa de agora toca normal):
    //  falhasNaPreCarga=n   responde 503 às n primeiras tentativas de cada faixa que NÃO é a de agora
    //                       (cofre ocupado/meta viva): a pré-carga morre e a promoção tem que se virar
    //  G34_COFRE_LENTO_MS=n segura a resposta n ms (a pré-carga não termina antes do fim)
    if (ehPreCarga && falhasNaPreCarga > 0) {
      const k = (falhas.get(id) ?? 0) + 1;
      falhas.set(id, k);
      if (k <= falhasNaPreCarga) {
        await route.fulfill({
          status: 503,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: 'cofre ocupado',
        });
        return;
      }
    }
    if (!ids.includes(id)) ids.push(id);
    const lento = ehPreCarga ? Number(process.env.G34_COFRE_LENTO_MS ?? 0) : 0;
    await new Promise((r) => setTimeout(r, ATRASO_DO_COFRE_MS + lento));
    const h = req.headers()['range'];
    const m = h ? /bytes=(\d*)-(\d*)/.exec(h) : null;
    const base = {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    if (m) {
      const ini = m[1] ? Number(m[1]) : 0;
      const fim = m[2] ? Math.min(Number(m[2]), corpo.length - 1) : corpo.length - 1;
      await route.fulfill({
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${ini}-${fim}/${corpo.length}` },
        body: corpo.subarray(ini, fim + 1),
      });
    } else {
      await route.fulfill({ status: 200, headers: base, body: corpo });
    }
  });
}

interface Audio {
  tocando: boolean;
  tempo: number;
  src: string;
}

/** O elemento que está soando (não pausado), achado pelo Howler. */
async function audio(page: Page): Promise<Audio | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const howls: any[] = (window as any).Howler?._howls ?? [];
    const nos: HTMLAudioElement[] = howls
      .map((h: any) => h?._sounds?.[0]?._node)
      .filter((n: unknown): n is HTMLAudioElement => Boolean(n));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ativo = nos.find((n) => !n.paused && n.currentTime > 0) ?? nos.find((n) => !n.paused);
    if (!ativo) return null;
    return { tocando: !ativo.paused, tempo: ativo.currentTime, src: ativo.currentSrc || ativo.src };
  });
}

/** Foto de todos os elementos do Howler (para o relatório de falha). */
async function diagnostico(page: Page): Promise<string> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const howls: any[] = (window as any).Howler?._howls ?? [];
    return JSON.stringify(
      howls.map((h: any) => {
        const n: HTMLAudioElement | undefined = h?._sounds?.[0]?._node;
        return n
          ? {
              src: (n.currentSrc || n.src).slice(-12),
              paused: n.paused,
              t: Math.round(n.currentTime * 10) / 10,
              d: n.duration,
              ended: n.ended,
              rs: n.readyState,
              err: n.error?.code ?? null,
              estado: h.state?.(),
            }
          : { semNo: true, estado: h.state?.() };
      }),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}

/**
 * O PERFIL É DECISIVO: o `perf:g34` emula um celular, e no celular o motor
 * NÃO monta o grafo Web Audio (`SEM_GRAFO_WEB_AUDIO`). A versão web de verdade
 * (computador) toca por contexto -> ganho de faixa -> fade -> EQ -> master, com
 * o elemento em CORS. Medir só o perfil de celular deixava esse caminho de fora.
 */
async function abrirDesktop(
  browser: Browser,
): Promise<{ page: Page; fechar: () => Promise<void> }> {
  const ctx = await browser.newContext({
    baseURL: ORIGEM,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    ignoreHTTPSErrors: true,
  });
  await prepararVisitante(ctx);
  await ctx.addInitScript(instalarSonda);
  const page = await ctx.newPage();
  await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false);
  await page.waitForTimeout(2_500);
  await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(ASSENTAR_MS);
  return { page, fechar: () => ctx.close() };
}

/** Mede o sinal que o app vê no analisador do fim do grafo (0 = mudo). */
async function espionarNivel(page: Page): Promise<void> {
  await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    w.__nivel = { n: 0, max: 0 };
    const orig = AnalyserNode.prototype.getByteTimeDomainData;
    AnalyserNode.prototype.getByteTimeDomainData = function (
      this: AnalyserNode,
      a: Uint8Array<ArrayBuffer>,
    ) {
      orig.call(this, a);
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] ?? 128) - 128));
      w.__nivel.n++;
      w.__nivel.max = Math.max(w.__nivel.max, m);
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}

async function nivel(page: Page): Promise<{ n: number; max: number }> {
  return page.evaluate(
    () => (window as unknown as { __nivel: { n: number; max: number } }).__nivel,
  );
}

async function tocarPrimeira(page: Page): Promise<string> {
  expect(await marcarCartao(page, 0)).toBe(true);
  await page.locator(ALVO).click();
  await expect
    .poll(async () => (await audio(page))?.tempo ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0.5);
  return (await audio(page))!.src;
}

/** Deixa a faixa acabar sozinha e exige que OUTRA esteja soando de verdade. */
async function fimNaturalEToca(page: Page, srcAtual: string): Promise<string> {
  try {
    await expect
      .poll(async () => (await audio(page))?.src ?? srcAtual, { timeout: 40_000 })
      .not.toBe(srcAtual);
    // Trocar o elemento não basta: o relógio da nova tem que andar.
    await expect
      .poll(async () => (await audio(page))?.tempo ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(1);
  } catch (e) {
    console.log('FALHOU — elementos:', await diagnostico(page));
    console.log(
      'FALHOU — tela:',
      await page.evaluate(() => ({
        avisos: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(
          (e) => (e as HTMLElement).innerText,
        ),
        botoes: Array.from(
          document.querySelectorAll('button[aria-label="Pausar"], button[aria-label="Reproduzir"]'),
        )
          .filter((b) => (b as HTMLElement).offsetParent !== null)
          .map((b) => b.getAttribute('aria-label')),
        barra: (document.querySelector('footer') as HTMLElement | null)?.innerText?.slice(0, 200),
      })),
    );
    throw e;
  }
  const depois = (await audio(page))!;
  expect(depois.tocando).toBe(true);
  return depois.src;
}

/** Há som DE VERDADE (sinal no analisador) logo depois da troca — só onde há grafo. */
async function exigirSom(page: Page, quando: string): Promise<void> {
  if (PERFIL === 'moto') return; // celular: sem grafo, sem analisador
  await page.evaluate(() => {
    (window as unknown as { __nivel: { max: number } }).__nivel.max = 0;
  });
  await page.waitForTimeout(3_000);
  const n = await nivel(page);
  console.log(`nível após ${quando}:`, JSON.stringify(n));
  expect(n.n, `o app nem mediu o sinal (${quando})`).toBeGreaterThan(0);
  expect(n.max, `silêncio no analisador (${quando})`).toBeGreaterThan(2);
}

async function ligarCrossfade(page: Page, segundos: number): Promise<void> {
  await page.evaluate((s) => {
    const j = JSON.parse(localStorage.getItem('aurial:settings') || '{"state":{}}');
    j.state = { ...j.state, crossfadeSeconds: s };
    localStorage.setItem('aurial:settings', JSON.stringify(j));
  }, segundos);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(6_000);
}

// `falhas` = 503 do cofre na pré-carga: com 2, a pré-carga (aos 5 s) E a primeira
// tentativa de carga completa falham; a regressão era o slot morto ser promovido e
// reusado pela retentativa — o título trocava e a música nunca começava.
const CENARIOS = [
  { cf: 0, falhas: 0 },
  { cf: 4, falhas: 0 },
  { cf: 0, falhas: 2 },
  { cf: 4, falhas: 2 },
];
for (const { cf, falhas } of CENARIOS) {
  const nome = falhas > 0 ? ` — cofre com ${falhas} x 503 na pré-carga` : '';
  test(`fim natural remoto — crossfade ${cf} s${nome} — duas trocas seguidas`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const corpo = gerarRecorte();
    const { page, fechar } = await abrir(browser);
    try {
      if (cf > 0) await ligarCrossfade(page, cf);
      const pedidos: string[] = [];
      await cofreCurto(page, corpo, pedidos, falhas);
      await espionarNivel(page);
      const a = await tocarPrimeira(page);
      const b = await fimNaturalEToca(page, a);
      expect(b).not.toBe(a);
      await exigirSom(page, 'seguinte 1');
      const c = await fimNaturalEToca(page, b);
      expect(c).not.toBe(b);
      await exigirSom(page, 'seguinte 2');
      console.log(`cf=${cf} pedidos ao cofre:`, pedidos.length);
    } finally {
      await fechar();
    }
  });
}

/**
 * PRÉ-CARGA VELHA — a seguinte fica um minuto ociosa no slot reserva (o
 * navegador suspende o elemento parado) e só depois é promovida. A faixa tem
 * 28 s (abaixo do portão de 30 s do visitante): toca 7 s, PAUSA por 70 s com a
 * pré-carga já feita, retoma e deixa acabar.
 */
test('fim natural remoto — pré-carga velha (ociosa 70 s)', async ({ browser }) => {
  test.skip(process.env.G34_VELHA !== '1', 'lento (~2 min): G34_VELHA=1');
  test.setTimeout(300_000);
  const corpo = gerarRecorte(28);
  const { page, fechar } = await abrir(browser);
  try {
    const pedidos: string[] = [];
    await cofreCurto(page, corpo, pedidos);
    const a = await tocarPrimeira(page);
    await page.waitForTimeout(7_000);
    // O play/pause da BARRA (os cartões também têm "Pausar" e vêm antes no DOM).
    const pausar = page.locator('button[aria-label="Pausar"]:visible').last();
    const reproduzir = page.locator('button[aria-label="Reproduzir"]:visible').last();
    await pausar.click();
    await expect(page.locator('button[aria-label="Pausar"]:visible')).toHaveCount(0, {
      timeout: 5_000,
    });
    await page.waitForTimeout(70_000);
    console.log('depois da espera:', await diagnostico(page));
    await reproduzir.click();
    const b = await fimNaturalEToca(page, a);
    expect(b).not.toBe(a);
    console.log('pedidos ao cofre:', pedidos.length);
  } finally {
    await fechar();
  }
});
