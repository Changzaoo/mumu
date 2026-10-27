/**
 * SONDA: ao pular de faixa, a ANTERIOR cala na hora?
 *
 * "Ele tá tocando uma música, pula pra outra, mas fica tocando a que tava
 * anterior; não avança" (27/10/2026). O defeito mora na janela em que a fonte
 * da faixa nova é resolvida com `await` (até 20 s com a cópia podada ou o
 * importador mudo): a tela já diz o nome da nova em 0:00 e o motor segue
 * tocando a velha.
 *
 * A sonda reproduz a janela de propósito: segura por 15 s a resposta de
 * `GET /catalogo/local:*` (o detalhe que o player pede para achar a fonte),
 * toca uma faixa, espera o som, clica em OUTRA e, 1,5 s e 5 s depois, lista o
 * que os elementos `<audio>` estão fazendo ao lado do que a barra do player
 * mostra. Prova: com o conserto, nenhum elemento toca enquanto a barra mostra
 * a nova faixa em "buscando"; sem ele, o elemento da anterior segue andando.
 *
 * Uso (em apps/web):
 *   node e2e/puloCalaAAnterior.probe.mjs [url] [foto.png]
 *   node e2e/puloCalaAAnterior.probe.mjs https://radinho.online antes.png
 *   node e2e/puloCalaAAnterior.probe.mjs http://localhost:5173 depois.png
 */
/* global window, HTMLMediaElement, localStorage, document, performance -- os corpos de evaluate/addInitScript rodam no navegador */
import { chromium } from '@playwright/test';

const [url = 'https://radinho.online', foto = 'pulo.png'] = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// Sem service worker: com ele no meio, o `page.route` abaixo não vê os pedidos.
const context = await browser.newContext({
  viewport: { width: 1200, height: 800 },
  serviceWorkers: 'block',
});
const page = await context.newPage();

await page.addInitScript(() => {
  try {
    const ajustes = JSON.parse(localStorage.getItem('aurial:settings') || '{"state":{}}');
    ajustes.state = { ...ajustes.state, dataNascimento: ajustes.state?.dataNascimento || '1990-01' };
    localStorage.setItem('aurial:settings', JSON.stringify(ajustes));
    if (!localStorage.getItem('aurial:gosto-inicial')) {
      localStorage.setItem('aurial:gosto-inicial', JSON.stringify({ generos: [], artistas: [] }));
    }
    localStorage.setItem('aurial:apk-dispensado-em', String(Date.now()));
  } catch {
    /* sem storage: segue */
  }
});

// Todo <audio> que recebeu `play()` fica anotado (o motor os cria fora do documento).
await page.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__els = new Set();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    w.__els.add(this);
    return play.apply(this, args);
  };
  w.__foto = () => ({
    barra: (document.querySelector('footer')?.textContent ?? '').slice(0, 70),
    tocando: Array.from(w.__els)
      .filter((e) => !e.paused)
      .map((e) => `${(e.currentSrc || '').replace(/\?k=.*$/, '').slice(-40)} @${e.currentTime.toFixed(1)}s`),
  });
});

// A janela do defeito: o detalhe do acervo demora 15 s a responder.
let segurar = false;
await page.route(/\/api\/catalogo\/local/, async (rota) => {
  if (segurar) await new Promise((r) => setTimeout(r, 15_000));
  await rota.continue();
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
const botoes = page.getByRole('button', { name: /^Reproduzir / });
await botoes.first().waitFor({ timeout: 180_000 }).catch(async (erro) => {
  await page.screenshot({ path: foto });
  console.log(`sem botões de play (${page.url()}): ${(await page.evaluate(() => document.body.innerText)).slice(0, 400)}`);
  throw erro;
});
const total = await botoes.count();
console.log(`app pronto · ${total} botões de play`);

const nome = async (i) => (await botoes.nth(i).getAttribute('aria-label'))?.replace(/^Reproduzir /, '');
const esperarSom = () =>
  page.waitForFunction(
    () => Array.from(/** @type {any} */ (window).__els).some((e) => !e.paused && e.currentTime > 0.5),
    null,
    { timeout: 60_000 },
  );

// 1. Toca a primeira e deixa o som sair.
console.log(`1. toca "${await nome(0)}"`);
await botoes.nth(0).click();
await esperarSom();
const antes = await page.evaluate(() => /** @type {any} */ (window).__foto());
console.log('   som saindo:', JSON.stringify(antes));
const srcAnterior = String(antes.tocando[0] ?? '').replace(/ @.*$/, '');

// 2. Com o detalhe segurado, pede OUTRA faixa (de outra prateleira, ainda sem detalhe).
segurar = true;
const alvo = Math.min(total - 1, 12);
console.log(`2. pula para "${await nome(alvo)}" com GET /catalogo/local segurado por 15 s`);
await botoes.nth(alvo).scrollIntoViewIfNeeded();
const t0 = await page.evaluate(() => performance.now());
await botoes.nth(alvo).click();
// O defeito é a ANTERIOR seguir tocando depois do pedido; a nova começar
// (quando a fonte chega) é o esperado.
let anteriorTocou = false;
for (const espera of [500, 1_500, 5_000]) {
  await page.waitForFunction((fim) => performance.now() >= fim, t0 + espera);
  const f = await page.evaluate(() => /** @type {any} */ (window).__foto());
  const aAnterior = f.tocando.some((t) => t.startsWith(srcAnterior));
  anteriorTocou ||= aAnterior;
  console.log(
    `   +${espera} ms · barra: "${f.barra}" · tocando: ${f.tocando.length ? f.tocando.join(', ') : 'NADA'}${aAnterior ? '  <- a ANTERIOR' : ''}`,
  );
  if (espera === 1_500) await page.screenshot({ path: foto });
}
const veredito = anteriorTocou
  ? 'DEFEITO: a anterior seguiu tocando depois do pulo'
  : 'OK: a anterior calou no pulo';
console.log(`
${veredito} · foto em ${foto}`);
await browser.close();
process.exit(anteriorTocou ? 2 : 0);
