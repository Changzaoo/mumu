/**
 * SONDA: a SEGUNDA vez que uma faixa toca, quanto tempo até o som — e de onde.
 *
 * O pedido (27/10/2026): "uma vez que o usuário escutar a música, ela fica no
 * aparelho e toca imediatamente" na próxima vez. Esta sonda mede exatamente
 * isso, num Chromium real, com o app de verdade:
 *
 *   1. toca a faixa A e cronometra o toque → som (1ª vez: rede);
 *   2. espera a faixa ficar guardada no aparelho (`aurial:downloads` com a
 *      entrada automática), ou não espera (`--sem-espera`, para o "antes");
 *   3. toca a faixa B (troca de faixa, para A não ser só "retomar");
 *   4. toca A de novo e cronometra o toque → som, anotando se a fonte foi
 *      `blob:` (do aparelho) e se saiu algum pedido de rede de áudio no meio.
 *
 * Uso (em apps/web):
 *   node e2e/guardadaAoOuvir.probe.mjs <url> [faixas] [--sem-espera] [--s8]
 *   node e2e/guardadaAoOuvir.probe.mjs https://radinho.online 3 --sem-espera   # antes
 *   node e2e/guardadaAoOuvir.probe.mjs http://localhost:5197 3                 # depois
 *
 * Não é spec do Playwright de propósito: mede rede e importador reais, e o
 * número varia com a conexão de quem mede. Meta do pedido: 2ª vez < 300 ms.
 */
/* global window, HTMLMediaElement, localStorage -- os corpos de evaluate/addInitScript rodam no navegador */
import { chromium } from '@playwright/test';

const posicionais = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const s8 = process.argv.includes('--s8');
const semEspera = process.argv.includes('--sem-espera');
const url = posicionais[0] ?? 'https://radinho.online';
const faixas = Number(posicionais[1] ?? 3);
/** Quanto esperar a guarda automática por faixa (a regra do app é ~30 s de escuta + download). */
const ESPERA_GUARDA_MS = 120_000;

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

// Relógio dentro da página: o primeiro `timeupdate` com o tempo andando, num
// elemento cujo `play()` foi chamado DEPOIS do clique medido (`gen`). Sem a
// geração, o elemento da faixa anterior — ainda tocando no instante do clique —
// marcava "saiu som" antes mesmo de a nova carga começar (tempo negativo).
await page.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__som = { t: 0, src: '', erro: '', gen: 0 };
  const vistos = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    this.__gen = w.__som.gen;
    if (!vistos.has(this)) {
      vistos.add(this);
      this.addEventListener('timeupdate', () => {
        if (this.__gen !== w.__som.gen) return;
        if (!w.__som.t && this.currentTime > 0.05 && !this.paused) {
          w.__som = { ...w.__som, t: performance.now(), src: this.currentSrc, erro: '' };
        }
      });
      this.addEventListener('error', () => {
        w.__som.erro = `media error ${this.error?.code}`;
      });
    }
    return play.apply(this, args);
  };
});

/** Pedidos de ÁUDIO à rede (o que a 2ª vez não pode ter antes do som). */
const pedidos = [];
page.on('request', (req) => {
  const u = req.url();
  if (!/catalogo\/|\/blob\/|\/stream\?|audius|\.mp3/.test(u)) return;
  pedidos.push({ t: performance.now(), u: u.replace(/\?k=\w+/, '?k=…').slice(0, 100) });
});

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
const botoes = page.getByRole('button', { name: /^Reproduzir / });
await botoes.first().waitFor({ timeout: 150_000 });
console.log(`app pronto com faixas em ${Date.now() - t0} ms`);

async function tocar(botao) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__som = { t: 0, src: '', erro: '', gen: (w.__som?.gen ?? 0) + 1 };
  });
  pedidos.length = 0;
  await botao.scrollIntoViewIfNeeded();
  const clique = await page.evaluate(() => performance.now());
  const cliqueAqui = performance.now();
  await botao.click();
  const ok = await page
    .waitForFunction(() => /** @type {any} */ (window).__som.t > 0, null, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  const som = await page.evaluate(() => /** @type {any} */ (window).__som);
  const ms = ok ? Math.round(som.t - clique) : null;
  const fonte = som.src ? som.src.split(/[:/]/).filter(Boolean)[0] : som.erro || '—';
  const redeAntesDoSom = ok
    ? pedidos.filter((p) => p.t - cliqueAqui <= som.t - clique + 5).length
    : pedidos.length;
  return { ms, fonte, redeAntesDoSom };
}

/** Quantas faixas guardadas (automáticas) o registro tem agora. */
async function guardadasAgora() {
  return page.evaluate(() => {
    try {
      const lista = JSON.parse(localStorage.getItem('aurial:downloads') || '[]');
      return Array.isArray(lista) ? lista.filter((e) => e?.automatico === true).length : 0;
    } catch {
      return 0;
    }
  });
}

const total = Math.min(faixas, (await botoes.count()) - 1);
const linhas = [];
for (let i = 0; i < total; i++) {
  const a = botoes.nth(i);
  const b = botoes.nth(i + 1);
  const nome =
    (await a.getAttribute('aria-label').catch(() => null))?.replace(/^Reproduzir /, '') ?? '?';

  // O estado persistido do player não guarda a faixa atual; a prova de que A foi
  // guardada é o registro de downloads ganhar UMA entrada automática a mais.
  const antes = await guardadasAgora();
  const primeira = await tocar(a);
  let guardou = false;
  if (!semEspera && primeira.ms !== null) {
    const limite = Date.now() + ESPERA_GUARDA_MS;
    while (Date.now() < limite) {
      if ((await guardadasAgora()) > antes) {
        guardou = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
  }
  await tocar(b); // troca de faixa: a 2ª vez de A é uma carga nova, não um resume
  await page.waitForTimeout(1500);
  const segunda = await tocar(a);

  linhas.push({ nome, primeira, guardou, segunda });
  // Não guardou: o diário do app diz por quê (falha de rede, cortada, cota…).
  if (!guardou && !semEspera) {
    const diario = await page.evaluate(() => {
      try {
        const l = JSON.parse(localStorage.getItem('aurial:diario') || '[]');
        const arr = Array.isArray(l) ? l : [];
        return arr.filter((x) => x?.c === 'download').slice(-4);
      } catch {
        return [];
      }
    });
    for (const d of diario)
      console.log(`       diário ${d.em} ${d.e}: ${String(d.d).slice(0, 110)}`);
  }
  const fmt = (r) =>
    r.ms === null ? 'SEM SOM' : `${r.ms} ms [${r.fonte}, rede antes do som: ${r.redeAntesDoSom}]`;
  console.log(
    `${String(i + 1).padStart(2)}. ${nome.slice(0, 44)}\n` +
      `      1ª vez: ${fmt(primeira)}\n` +
      `      guardada no aparelho: ${guardou ? 'sim' : semEspera ? '(não esperou)' : 'NÃO'}\n` +
      `      2ª vez: ${fmt(segunda)}`,
  );
}

const segundas = linhas
  .map((l) => l.segunda.ms)
  .filter((m) => m !== null)
  .sort((x, y) => x - y);
const mediana = segundas[Math.floor(segundas.length / 2)];
console.log(
  `\n2ª vez: ${segundas.length}/${linhas.length} tocaram · mediana ${mediana} ms · pior ${segundas.at(-1)} ms · ` +
    `do aparelho: ${linhas.filter((l) => l.segunda.fonte === 'blob').length}/${linhas.length}`,
);
await browser.close();
