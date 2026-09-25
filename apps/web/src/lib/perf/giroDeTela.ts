/**
 * GIRAR A TELA COMO NUM APP DA APPLE — cada coisa desliza até o lugar novo.
 *
 * Num app nativo do iPhone, girar o aparelho não troca a tela de uma vez: a
 * barra se estica, as capas andam, os cards se rearrumam — cada peça vai do
 * lugar antigo ao novo. Numa página, o layout SALTA de retrato para paisagem
 * num quadro só. O pedido foi o do iPhone: "os itens deslizarem até o novo
 * lugar".
 *
 * ── POR QUE NÃO DÁ PARA FOTOGRAFAR O "ANTES" NA HORA ──
 *
 * A primeira ideia é a View Transitions API: foto do antes, foto do depois, e o
 * navegador anima cada peça. Mas o aviso de giro chega com o layout JÁ refeito
 * — e segurar o tamanho do app não congela nada, porque o layout muda de forma
 * por media query (`md:` a 768px: o celular deitado tem 844px e vira o layout
 * de computador, com menu lateral), e media query responde à janela no mesmo
 * instante. Não sobra "antes" para fotografar.
 *
 * ── ENTÃO O "ANTES" JÁ ESTÁ ANOTADO (FLIP) ──
 *
 * O app mantém anotada a posição das peças marcadas com `data-giro` que estão
 * na tela — medida barata, feita ao parar de rolar e de tempos em tempos, e só
 * em tela de toque (é onde gira). Quando o aparelho gira, cada peça é posta de
 * volta, por transform, onde ESTAVA, e anima até onde ESTÁ, na curva de mola
 * das folhas do iOS. Peça que não existia antes (o menu lateral que surge na
 * paisagem) entra num fade curto; peça que sumiu, some.
 *
 *  - `data-giro="barra"`: moldura (barras, menu, abas) — pode esticar em cada
 *    eixo, como a barra do iOS se alongando;
 *  - `data-giro="item"`: cards, linhas, títulos — escala UNIFORME, senão o
 *    texto distorce no caminho.
 *
 * Peças marcadas não ficam uma dentro da outra: o movimento do pai se somaria
 * ao do filho. Só `transform` e `opacity` (composição, sem repintura). Some sob
 * `prefers-reduced-motion`.
 */

export interface Caixa {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Curva de mola das folhas do iOS, e o tempo dela. */
const CURVA = 'cubic-bezier(0.32, 0.72, 0, 1)';
const DURACAO_MS = 520;
/** Quantas peças medir no máximo: basta o que está na tela. */
const MAX_PECAS = 80;
/** Remedição de fundo; a principal é ao parar de rolar. */
const INTERVALO_MS = 2_500;

/**
 * O transform que põe a peça (já na caixa NOVA `b`) de volta sobre a caixa
 * ANTIGA `a`. `null` quando não há o que animar (mesmo lugar, ou medida podre).
 * Pura, para ser testada sem tela.
 */
export function transformInverso(a: Caixa, b: Caixa, tipo: 'barra' | 'item'): string | null {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return null;
  const dx = a.left - b.left;
  const dy = a.top - b.top;
  let sx = a.width / b.width;
  let sy = a.height / b.height;
  if (tipo === 'item') sx = sy = Math.sqrt(sx * sy);
  // Uma escala absurda é medida de peça que mudou de natureza (lista que virou
  // grade inteira): esticar 10x no caminho seria um borrão, não um movimento.
  const limitar = (v: number) => Math.min(3, Math.max(1 / 3, v));
  sx = limitar(sx);
  sy = limitar(sy);
  const parado =
    Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01;
  if (parado) return null;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

let instalado = false;
let anotadas = new Map<Element, Caixa>();
/** Quando o último giro começou — um segundo aviso no meio dele é o mesmo giro. */
let ultimoGiro = -Infinity;
let remedirTimer: ReturnType<typeof setTimeout> | null = null;

const naTela = (c: Caixa): boolean =>
  c.width > 0 &&
  c.height > 0 &&
  c.top < window.innerHeight &&
  c.top + c.height > 0 &&
  c.left < window.innerWidth &&
  c.left + c.width > 0;

function caixaDe(el: Element): Caixa {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Anota onde cada peça visível está agora. */
function anotar(): void {
  const novas = new Map<Element, Caixa>();
  for (const el of document.querySelectorAll('[data-giro]')) {
    const c = caixaDe(el);
    if (!naTela(c)) continue;
    novas.set(el, c);
    if (novas.size >= MAX_PECAS) break;
  }
  anotadas = novas;
}

function agendarRemedicao(): void {
  if (remedirTimer !== null) clearTimeout(remedirTimer);
  remedirTimer = setTimeout(() => {
    remedirTimer = null;
    // Aba escondida não gira na mão de ninguém: nada a medir.
    if (!document.hidden) {
      const ocioso = (window as Window & { requestIdleCallback?: (cb: () => void) => void })
        .requestIdleCallback;
      if (ocioso) ocioso(anotar);
      else anotar();
    }
    agendarRemedicao();
  }, INTERVALO_MS);
}

/** O aparelho girou: cada peça sai de onde estava e desliza até onde está. */
function girar(): void {
  // UM GIRO, UMA ANIMAÇÃO. O navegador pode avisar duas vezes (a API de
  // orientação e a troca da media query, ou o aviso repetido de alguns
  // aparelhos): a segunda chamada reiniciaria o fade do que acabou de chegar
  // e mediria peças já em movimento. Medido na bancada: o menu lateral
  // piscava entrando duas vezes.
  const agora = performance.now();
  if (agora - ultimoGiro < DURACAO_MS + 200) return;
  ultimoGiro = agora;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    anotar();
    return;
  }
  const antes = anotadas;
  // A medição nova sai no próximo quadro: é quando o layout novo está pronto.
  requestAnimationFrame(() => {
    const vistos = new Set<Element>();
    for (const [el, a] of antes) {
      if (!el.isConnected) continue;
      const b = caixaDe(el);
      if (!naTela(b)) continue;
      vistos.add(el);
      const tipo = el.getAttribute('data-giro') === 'barra' ? 'barra' : 'item';
      const inverso = transformInverso(a, b, tipo);
      if (!inverso) continue;
      (el as HTMLElement).animate(
        [
          { transform: inverso, transformOrigin: 'top left' },
          { transform: 'none', transformOrigin: 'top left' },
        ],
        { duration: DURACAO_MS, easing: CURVA },
      );
    }
    // Quem não estava na tela antes chega num fade curto, um pouco atrasado,
    // para não disputar o olho com o que está andando.
    for (const el of document.querySelectorAll('[data-giro]')) {
      if (vistos.has(el)) continue;
      const b = caixaDe(el);
      if (!naTela(b)) continue;
      (el as HTMLElement).animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 380, delay: 120, easing: CURVA, fill: 'backwards' },
      );
    }
    // O "antes" do próximo giro é o layout que acabou de assentar.
    setTimeout(anotar, DURACAO_MS + 80);
  });
}

export function instalarGiroDeTela(): void {
  if (instalado || typeof window === 'undefined') return;
  // Só onde a tela gira na mão: no computador não há o que animar, e medir
  // peças de tempos em tempos seria trabalho à toa.
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  instalado = true;

  // A medição principal: ao PARAR de rolar (a posição que vale é a de repouso)
  // e ao soltar o dedo. `scrollend` não borbulha — escuta na captura.
  document.addEventListener('scrollend', anotar, { capture: true, passive: true });
  document.addEventListener('touchend', () => setTimeout(anotar, 350), { passive: true });
  window.addEventListener('load', anotar, { once: true });
  agendarRemedicao();

  const orientacao = typeof screen !== 'undefined' ? screen.orientation : undefined;
  if (orientacao && typeof orientacao.addEventListener === 'function') {
    orientacao.addEventListener('change', girar);
    return;
  }
  // Sem a API: a troca retrato/paisagem da janela, que em tela de toque é giro.
  window.matchMedia('(orientation: portrait)').addEventListener('change', girar);
}
