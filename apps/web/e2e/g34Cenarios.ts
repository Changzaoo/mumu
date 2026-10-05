/// <reference lib="dom" />
/**
 * CENÁRIOS COMPARTILHADOS do arnês G34: abrir o app "quente" com o perfil do
 * aparelho e os ganchos de áudio. Usado pelas specs de interação e de perfil.
 */
import type { Browser, CDPSession, Locator, Page } from '@playwright/test';
import { CPU_PADRAO, estrangular, novoContextoG34, prepararVisitante } from './motoG34';
import { instalarSonda } from './g34Medicao';

export const ASSENTAR_MS = 10_000;

/** Ganchos de áudio: instante (rAF, ~16 ms) em que o relógio do <audio> anda. */
export function instalarSom(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__som = { t: 0, src: '' };
  w.__toque = 0;
  window.addEventListener(
    'pointerdown',
    (e) => {
      w.__toque = e.timeStamp;
    },
    true,
  );
  const vistos = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
    if (!vistos.has(this)) {
      vistos.add(this);
      const olhar = (): void => {
        if (!w.__som.t && this.currentTime > 0.02 && !this.paused) {
          w.__som = { t: performance.now(), src: this.currentSrc };
          return;
        }
        requestAnimationFrame(olhar);
      };
      this.addEventListener('playing', () => requestAnimationFrame(olhar));
    }
    return play.apply(this, args);
  };
}

export interface App {
  page: Page;
  cdp: CDPSession;
  fechar: () => Promise<void>;
}

export async function abrirApp(browser: Browser, cpu = CPU_PADRAO, url = '/'): Promise<App> {
  const ctx = await novoContextoG34(browser);
  await prepararVisitante(ctx);
  await ctx.addInitScript(instalarSonda);
  await ctx.addInitScript(instalarSom);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await estrangular(cdp, cpu, '4g');
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false);
  await page.waitForTimeout(2_500);
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 }); // 2ª abertura: quente
  await page.waitForTimeout(ASSENTAR_MS);
  return { page, cdp, fechar: () => ctx.close() };
}

export const agora = (page: Page): Promise<number> => page.evaluate(() => performance.now());

export async function rolar(cdp: CDPSession, y: number, x = 180, velocidade = 2200): Promise<void> {
  await cdp.send('Input.synthesizeScrollGesture', {
    x,
    y: 600,
    xDistance: 0,
    yDistance: y,
    speed: velocidade,
    gestureSourceType: 'touch',
  });
}

/**
 * Marca o N-ésimo cartão tocável que está dentro da tela (na horizontal) com
 * `data-g34="alvo"` e o traz para o centro. Cartões de carrossel são `div
 * role=button` e os que sobram fora da vista têm `x` negativo — um seletor por
 * papel/visibilidade os confundiria (e o `getByRole` do Playwright, num DOM de
 * 17 mil nós, custa segundos de CPU estrangulada e polui a medição).
 */
export async function marcarCartao(page: Page, n: number): Promise<boolean> {
  return page.evaluate((i) => {
    document.querySelectorAll('[data-g34="alvo"]').forEach((e) => e.removeAttribute('data-g34'));
    const todos = Array.from(document.querySelectorAll('main [aria-label^="Reproduzir "]'));
    const visiveis = todos.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 20 && r.left >= 0 && r.right <= window.innerWidth + 1;
    });
    const el = visiveis[i];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.setAttribute('data-g34', 'alvo');
    return true;
  }, n);
}

export const ALVO = '[data-g34="alvo"]';

/**
 * Centro (em px de viewport) do primeiro link `main a[href^=prefixo]` dentro da
 * tela, já com o scroll aplicado. Devolve o PONTO, não o elemento: a Home troca
 * os nós das prateleiras de lugar a qualquer momento, e o toque por coordenada
 * logo em seguida é o que sobrevive a isso.
 */
export async function pontoDoLink(
  page: Page,
  prefixo: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((p) => {
    const el = Array.from(document.querySelectorAll(`main a[href^="${p}"]`)).find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 20 && r.left >= 0 && r.right <= window.innerWidth + 1;
    });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, prefixo);
}

/** Ponto central de um locator (para abas e botões fixos). */
export async function pontoDe(alvo: Locator): Promise<{ x: number; y: number } | null> {
  const b = await alvo.boundingBox({ timeout: 4_000 }).catch(() => null);
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

/**
 * Toque REAL (evento de toque no centro do elemento), sem as esperas de
 * "estável/visível" do `locator.tap()`. Essas esperas, num DOM de 17 mil nós
 * com a CPU estrangulada, levavam minutos — e o elemento era substituído (a
 * Home remonta prateleiras) antes de o Playwright decidir tocar. O evento que o
 * app recebe é o mesmo; só some a coreografia do teste.
 */
export async function tapar(page: Page, alvo: Locator): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const caixa = await alvo.boundingBox({ timeout: 4_000 }).catch(() => null);
    if (caixa && caixa.width > 0) {
      await page.touchscreen.tap(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`alvo não encontrado para o toque: ${String(alvo)}`);
}
