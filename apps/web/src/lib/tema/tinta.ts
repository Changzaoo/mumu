/**
 * A TROCA DE TEMA COMO TINTA SE INFILTRANDO NA TELA.
 *
 * O navegador fotografa a tela no tema antigo e desenha o novo por baixo (View
 * Transitions). O tema novo é revelado por uma MANCHA que nasce onde a pessoa
 * tocou e se espalha com a borda irregular de tinta no papel: um polígono de
 * 72 pontos cujo raio é modulado por ondas de fases sorteadas, que crescem e
 * se deformam a cada quadro-chave até cobrir a tela inteira.
 *
 * Só o recorte (`clip-path`) é animado, sobre a imagem já pronta — nada de
 * layout nem de pintura por quadro. Sem suporte (Firefox antigo), com "menos
 * movimento" ou em aparelho fraco, a troca é imediata, como antes.
 */
import { modoLeve } from '@/lib/perf/dispositivo';

let ultimoToque: { x: number; y: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      ultimoToque = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
}

const VERTICES = 72;
const QUADROS = 14;
const DURACAO_MS = 950;

function mancha(
  cx: number,
  cy: number,
  raio: number,
  ondas: { freq: number; fase: number; amp: number; deriva: number }[],
  t: number,
): string {
  const pontos: string[] = [];
  for (let i = 0; i < VERTICES; i++) {
    const a = (i / VERTICES) * Math.PI * 2;
    // A borda é mais irregular no meio do caminho e se acalma no fim, quando a
    // tinta já tomou a tela (senão sobrariam cantos sem cor).
    const irregular = Math.sin(Math.PI * Math.min(1, t * 1.15));
    let r = 1;
    for (const o of ondas) r += o.amp * irregular * Math.sin(o.freq * a + o.fase + o.deriva * t);
    const rr = Math.max(0, raio * r);
    pontos.push(`${(cx + rr * Math.cos(a)).toFixed(1)}px ${(cy + rr * Math.sin(a)).toFixed(1)}px`);
  }
  return `polygon(${pontos.join(',')})`;
}

function semMovimento(ajuste: 'on' | 'off' | 'system'): boolean {
  if (ajuste === 'on') return true;
  if (ajuste === 'off') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type DocComTransicao = Document & {
  startViewTransition?: (atualizar: () => void) => { ready: Promise<void> };
};

/** Aplica a troca de tema; se der, com a tinta se espalhando a partir do toque. */
export function trocarComTinta(aplicar: () => void, reducedMotion: 'on' | 'off' | 'system'): void {
  const doc = document as DocComTransicao;
  if (!doc.startViewTransition || semMovimento(reducedMotion) || modoLeve()) {
    aplicar();
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { x, y } = ultimoToque ?? { x: w / 2, y: h / 2 };
  // Até o canto mais longe, com folga para a borda ondulada não deixar vão.
  const fim = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * 1.35;
  const ondas = Array.from({ length: 5 }, (_, i) => ({
    freq: [3, 5, 7, 11, 17][i]!,
    fase: Math.random() * Math.PI * 2,
    amp: [0.09, 0.07, 0.05, 0.035, 0.02][i]!,
    deriva: (Math.random() - 0.5) * 3,
  }));
  const quadros = Array.from({ length: QUADROS + 1 }, (_, k) => {
    const t = k / QUADROS;
    // Tinta: espalha depressa no começo, infiltra devagar no fim.
    const avance = 1 - Math.pow(1 - t, 2.4);
    return { clipPath: mancha(x, y, Math.max(1, fim * avance), ondas, t) };
  });

  document.documentElement.classList.add('tema-tinta');
  const transicao = doc.startViewTransition(aplicar);
  transicao.ready
    .then(() => {
      const anim = document.documentElement.animate(quadros, {
        duration: DURACAO_MS,
        easing: 'linear',
        pseudoElement: '::view-transition-new(root)',
      });
      anim.finished
        .finally(() => document.documentElement.classList.remove('tema-tinta'))
        .catch(() => undefined);
    })
    .catch(() => document.documentElement.classList.remove('tema-tinta'));
}
