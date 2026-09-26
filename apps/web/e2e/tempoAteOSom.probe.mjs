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
 *
 * Não é spec do Playwright de propósito: mede a PRODUÇÃO (rede, cofre, API),
 * que não cabe num portão de CI — o número varia com o 4G de quem mede.
 */
/* global window, HTMLMediaElement -- os corpos de evaluate/addInitScript rodam no navegador */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'https://radinho.online';
const faixas = Number(process.argv[3] ?? 10);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();

// Relógio dentro da página: o primeiro `timeupdate` com o tempo andando, em
// qualquer <audio>. O Howler cria os elementos FORA do documento, e aí nem a
// captura no `document` os vê — por isso a escuta entra pelo `play()`.
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
  const nome = (await botao.getAttribute('aria-label'))?.replace(/^Reproduzir /, '') ?? '?';
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
