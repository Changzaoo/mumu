/**
 * SONDA: quanto tempo entre o SOM e a LETRA, com bytes reais e o app de verdade.
 *
 * "A música tem que começar e a letra já tem que estar lá" (Vinicius,
 * 27/10/2026). Esta sonda abre o app num Chromium real com a tela da letra
 * aberta, toca N faixas e cronometra, para cada uma, do clique até:
 *   • o SOM — o relógio do `<audio>` andar (currentTime > 0,05), como em
 *     `tempoAteOSom.probe.mjs`;
 *   • a LETRA — a tela da letra mostrar as linhas DESTA faixa (ou dizer que
 *     não há letra), sem esqueleto.
 * O número que importa é `letra − som`: negativo = a letra estava na tela
 * antes de sair som; positivo = a pessoa ouviu a música sem letra por esse tanto.
 *
 * Duas passadas sobre as MESMAS faixas, com a página recarregada entre elas:
 *   1ª "fria": cache de letras vazio — mede a letra que precisa de rede;
 *   2ª "morna": a letra já está no aparelho — mede a letra em cache.
 *
 * Uso (em apps/web):
 *   node e2e/tempoAteALetra.probe.mjs [url] [faixas]
 *   node e2e/tempoAteALetra.probe.mjs https://radinho.online 6
 *
 * Não é spec do Playwright de propósito: mede a PRODUÇÃO (rede, LRCLIB,
 * importador), que não cabe num portão de CI.
 */
/* global window, HTMLMediaElement, localStorage, sessionStorage, document, performance -- os corpos de evaluate/addInitScript rodam no navegador */
import { chromium } from '@playwright/test';

const posicionais = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = posicionais[0] ?? 'https://radinho.online';
const faixas = Number(posicionais[1] ?? 6);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });

// Visitante novo: responde de antemão o que o app pergunta na primeira visita,
// esvazia o cache de letras (a 1ª passada tem de ser fria) e abre o app já com
// a tela da letra (`aurial:tela-ao-recarregar` é o que o app usa ao recarregar).
await context.addInitScript(() => {
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
    if (!sessionStorage.getItem('__sonda-passada')) {
      localStorage.removeItem('aurial:lyrics-cache');
      sessionStorage.setItem('__sonda-passada', '1');
    }
    sessionStorage.setItem(
      'aurial:tela-ao-recarregar',
      JSON.stringify({ nowPlayingOpen: true, lyricsOpen: true, clipeOpen: false, queueOpen: false }),
    );
  } catch {
    /* sem storage: segue */
  }
});

// Relógio do som: o primeiro `timeupdate` com o tempo andando, em qualquer
// <audio> que recebeu `play()` (os elementos vivem fora do documento).
await context.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__som = { t: 0, src: '' };
  const vistos = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!vistos.has(this)) {
      vistos.add(this);
      this.addEventListener('timeupdate', () => {
        if (!w.__som.t && this.currentTime > 0.05 && !this.paused) {
          w.__som = { t: performance.now(), src: this.currentSrc };
        }
      });
    }
    return play.apply(this, args);
  };
  // Relógio da letra: a tela da letra mudou para linhas (ou para "sem letra").
  // Um MutationObserver marca a hora da PINTURA, não a do poll da sonda.
  w.__letra = { t: 0, texto: '', estado: '' };
  w.__lerLetra = () => {
    const caixa = document.querySelector('[aria-label="Letra da música"]');
    if (caixa) {
      const texto = (caixa.textContent || '').replace(/\s+/g, ' ').trim();
      return { estado: 'linhas', texto };
    }
    if (document.querySelector('[aria-label="Tocando agora"]')?.textContent?.includes('Sem letra')) {
      return { estado: 'sem letra', texto: '' };
    }
    return { estado: 'esqueleto', texto: '' };
  };
  w.__armarLetra = (antes) => {
    w.__letra = { t: 0, texto: '', estado: '' };
    const conferir = () => {
      if (w.__letra.t) return;
      const agora = w.__lerLetra();
      if (agora.estado === 'esqueleto') return;
      if (agora.estado === 'linhas' && (agora.texto === antes || agora.texto.length < 20)) return;
      w.__letra = { t: performance.now(), ...agora };
    };
    const obs = new MutationObserver(conferir);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    conferir();
  };
});

const page = await context.newPage();
const pedidos = [];
page.on('requestfinished', (req) => {
  const u = req.url();
  if (!/lrclib|\/lyrics|\/tempo|\/alinhar|\/calibr/.test(u)) return;
  pedidos.push({ u: u.replace(/\?.*$/, '').slice(-70), ms: Math.round(req.timing().responseEnd) });
});

async function passada(nome) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const botoes = page.getByRole('button', { name: /^Reproduzir / });
  await botoes.first().waitFor({ timeout: 120_000 });
  console.log(`\n── passada ${nome}: app pronto em ${Date.now() - t0} ms`);

  const total = Math.min(faixas, await botoes.count());
  const linhas = [];
  for (let i = 0; i < total; i++) {
    // A 1ª faixa entra pela prateleira; as seguintes por "Próxima", que é o
    // caminho de quem ouve uma fila (a tela cheia cobre a prateleira).
    const botao =
      i === 0
        ? botoes.nth(0)
        : page.locator('[aria-label="Tocando agora"]').getByRole('button', { name: 'Próxima' });
    const nomeAntes = await page.evaluate(
      () => document.querySelector('[aria-label="Tocando agora"] h1, [aria-label="Tocando agora"] h2')?.textContent ?? '',
    );
    const textoAntes = await page.evaluate(() => /** @type {any} */ (window).__lerLetra().texto);
    pedidos.length = 0;
    await page.evaluate((antes) => {
      const w = /** @type {any} */ (window);
      w.__som = { t: 0, src: '' };
      w.__armarLetra(antes);
    }, textoAntes);
    const clique = await page.evaluate(() => performance.now());
    // Na 2ª passada a tela cheia (restaurada) cobre a prateleira: o clique vai
    // direto ao elemento, sem passar pela checagem de "quem está por cima".
    if (i === 0) await botao.dispatchEvent('click');
    else await botao.click();
    const ok = await page
      .waitForFunction(
        () => {
          const w = /** @type {any} */ (window);
          return w.__som.t > 0 && w.__letra.t > 0;
        },
        null,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    const { som, letra, titulo } = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return {
        som: w.__som,
        letra: w.__letra,
        titulo:
          document.querySelector('[aria-label="Tocando agora"] h1, [aria-label="Tocando agora"] h2')
            ?.textContent ?? '?',
      };
    });
    const somMs = som.t ? Math.round(som.t - clique) : null;
    const letraMs = letra.t ? Math.round(letra.t - clique) : null;
    const delta = somMs !== null && letraMs !== null ? letraMs - somMs : null;
    linhas.push({ delta, estado: letra.estado });
    const rotulo = titulo === nomeAntes && i > 0 ? `${titulo} (não trocou?)` : titulo;
    console.log(
      `${String(i + 1).padStart(2)}. som ${somMs === null ? '  —  ' : `${somMs} ms`.padStart(7)} · letra ${
        letraMs === null ? '  —  ' : `${letraMs} ms`.padStart(7)
      } · letra−som ${delta === null ? '  —  ' : `${delta > 0 ? '+' : ''}${delta} ms`.padStart(8)}  [${letra.estado || (ok ? '?' : 'tempo esgotado')}]  ${rotulo.slice(0, 40)}`,
    );
    for (const p of pedidos) console.log(`       ${String(p.ms).padStart(5)} ms  ${p.u}`);
    if (!letra.t) {
      // O que a tela mostrava quando desistimos — para a sonda não mentir por
      // um seletor que não bate (letra sendo feita, sem letra, esqueleto).
      const tela = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const agora = w.__lerLetra();
        const secao = document.querySelector('[aria-label="Tocando agora"]');
        return `${agora.estado} · ${agora.texto.slice(0, 60)} · tela: ${(secao?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 220)}`;
      });
      console.log(`       tela ao desistir: ${tela} · antes: ${textoAntes.slice(0, 60)}`);
    }
  }
  const deltas = linhas.filter((l) => l.delta !== null).map((l) => l.delta).sort((a, b) => a - b);
  const pct = (p) => deltas[Math.min(deltas.length - 1, Math.floor((p / 100) * deltas.length))];
  const antes = deltas.filter((d) => d <= 0).length;
  console.log(
    `   ${nome}: ${deltas.length}/${linhas.length} medidas · letra antes do som em ${antes} · mediana ${pct(50)} ms · pior +${deltas.at(-1)} ms`,
  );
}

await passada('fria (sem cache de letras)');
await passada('morna (letra no aparelho)');
await browser.close();
