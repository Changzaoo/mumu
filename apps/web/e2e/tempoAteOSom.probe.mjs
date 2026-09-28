/**
 * SONDA: quanto tempo do toque até o SOM, com bytes reais e o app de verdade.
 *
 * Os testes de unidade provam as regras do player contra dublês de `<audio>`;
 * nenhum deles mede o que a pessoa sente. Esta sonda abre o app num Chromium
 * real, toca N faixas diferentes e cronometra do clique até o relógio do
 * `<audio>` andar (currentTime > 0), que é quando o som já está saindo.
 *
 * Uso (em apps/web):
 *   node e2e/tempoAteOSom.probe.mjs [url] [faixas]
 *   node e2e/tempoAteOSom.probe.mjs https://radinho.online 12
 *   node e2e/tempoAteOSom.probe.mjs https://radinho.online 12 --s8
 *
 * `--s8` emula um Galaxy S8: tela 360×740 (DPR 3), toque, user agent de
 * Android, CPU 4× mais lenta e 4G (9 Mbps / 60 ms). É o aparelho em que a
 * espera para começar a tocar mais aparece.
 *
 * Não é spec do Playwright de propósito: mede a PRODUÇÃO (rede, cofre, API),
 * que não cabe num portão de CI — o número varia com o 4G de quem mede.
 */
/* global window, HTMLMediaElement, localStorage -- os corpos de evaluate/addInitScript rodam no navegador */
import { chromium } from '@playwright/test';

const posicionais = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const s8 = process.argv.includes('--s8');
const url = posicionais[0] ?? 'https://radinho.online';
const faixas = Number(posicionais[1] ?? 10);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(
  s8
    ? {
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 9; SM-G950F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      }
    : {},
);
if (s8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 60,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  });
  console.log('emulando Galaxy S8 (CPU 4×, 4G)');
}

// Relógio dentro da página: o primeiro `timeupdate` com o tempo andando, em
// qualquer <audio>. O Howler cria os elementos FORA do documento, e aí nem a
// captura no `document` os vê — por isso a escuta entra pelo `play()`.
// Visitante novo: responde de antemão o que o app PERGUNTA na primeira visita
// (idade, onboarding). Um diálogo aberto esconde o resto da tela da árvore de
// acessibilidade, e a sonda deixava de achar os botões de play.
await page.addInitScript(() => {
  try {
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
    /* sem storage: segue */
  }
});

await page.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__som = { t: 0, src: '', erro: '' };
  const vistos = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!vistos.has(this)) {
      vistos.add(this);
      this.addEventListener('timeupdate', () => {
        if (!w.__som.t && this.currentTime > 0.05 && !this.paused) {
          w.__som = { t: performance.now(), src: this.currentSrc, erro: '' };
        }
      });
      this.addEventListener('error', () => {
        w.__som.erro = `media error ${this.error?.code}`;
      });
    }
    return play.apply(this, args);
  };
});

const pedidos = [];
page.on('requestfinished', async (req) => {
  const u = req.url();
  if (!/catalogo\/|\/blob\/|\/stream\?/.test(u)) return;
  const t = req.timing();
  pedidos.push({ u: u.replace(/\?k=\w+/, '?k=…').slice(0, 110), ms: Math.round(t.responseStart) });
});

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
const botoes = page.getByRole('button', { name: /^Reproduzir / });
await botoes.first().waitFor({ timeout: 60_000 });
console.log(`app pronto com faixas em ${Date.now() - t0} ms`);

const total = Math.min(faixas, await botoes.count());
const tempos = [];
for (let i = 0; i < total; i++) {
  const botao = botoes.nth(i);
  const nome = await botao
    .getAttribute('aria-label', { timeout: 15_000 })
    .then((n) => n?.replace(/^Reproduzir /, '') ?? '?')
    .catch(async () => {
      await page.screenshot({ path: 'sonda-travou.png' });
      console.log(`botão ${i + 1} sumiu da tela — foto em sonda-travou.png (url: ${page.url()})`);
      return null;
    });
  if (nome === null) break;
  await page.evaluate(() => {
    /** @type {any} */ (window).__som = { t: 0, src: '' };
  });
  pedidos.length = 0;
  await botao.scrollIntoViewIfNeeded();
  const clique = await page.evaluate(() => performance.now());
  await botao.click();
  const ok = await page
    .waitForFunction(() => /** @type {any} */ (window).__som.t > 0, null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const som = await page.evaluate(() => /** @type {any} */ (window).__som);
  const ms = ok ? Math.round(som.t - clique) : null;
  tempos.push(ms);
  const fonte = som.src ? new URL(som.src).pathname.split('/')[1] : som.erro || '—';
  console.log(
    `${String(i + 1).padStart(2)}. ${ok ? `${ms} ms`.padStart(8) : '  SEM SOM'}  [${fonte}]  ${nome.slice(0, 50)}`,
  );
  for (const p of pedidos) console.log(`       ${String(p.ms).padStart(5)} ms  ${p.u}`);
}

const bons = tempos.filter((t) => t !== null).sort((a, b) => a - b);
const pct = (p) => bons[Math.min(bons.length - 1, Math.floor((p / 100) * bons.length))];
console.log(
  `\n${bons.length}/${tempos.length} tocaram · mediana ${pct(50)} ms · p90 ${pct(90)} ms · pior ${bons.at(-1)} ms`,
);
await browser.close();
