/**
 * O ÍCONE DO PLAY QUE SE TRANSFORMA — play ↔ pausa ↔ disco, sem trocar de
 * figura "do nada".
 *
 * Cada estado é desenhado por DUAS metades (esquerda e direita), e cada metade
 * é um polígono reamostrado para o mesmo número de pontos, na mesma ordem
 * (horária, a partir do canto de cima à esquerda). Assim qualquer estado vira
 * qualquer outro interpolando ponto a ponto: o triângulo do play se parte nas
 * duas barras da pausa, que se arredondam nas duas metades do disco.
 *
 * Custo: 2 × 24 pontos, escritos direto no atributo `d` por um laço de quadros
 * que SÓ roda durante a transição (~240 ms) — nenhum re-render do React por
 * quadro, e nada rodando quando o ícone está parado. Sem movimento pedido, a
 * troca é imediata.
 */
import { useEffect, useRef } from 'react';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { cn } from '@/lib/utils';

export type EstadoDoPlay = 'play' | 'pausa' | 'carregando';

type Ponto = readonly [number, number];
type Forma = readonly [Ponto[], Ponto[]];

const PONTOS = 24;
const DURACAO_MS = 240;

/** Reamostra um polígono fechado em `n` pontos igualmente espaçados no perímetro. */
function reamostrar(vertices: readonly Ponto[], n = PONTOS): Ponto[] {
  const lados = vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length]!;
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const total = lados.reduce((s, l) => s + l.len, 0);
  const out: Ponto[] = [];
  for (let k = 0; k < n; k++) {
    let alvo = (k / n) * total;
    for (const l of lados) {
      if (alvo <= l.len || l === lados[lados.length - 1]) {
        const t = l.len > 0 ? Math.min(1, alvo / l.len) : 0;
        out.push([l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t]);
        break;
      }
      alvo -= l.len;
    }
  }
  return out;
}

/** Arco da circunferência (centro 12,12) de `de` a `ate` graus, em `passos` pontos. */
function arco(r: number, de: number, ate: number, passos: number): Ponto[] {
  return Array.from({ length: passos + 1 }, (_, i) => {
    const a = ((de + ((ate - de) * i) / passos) * Math.PI) / 180;
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)] as const;
  });
}

const R = 9;
const FORMAS: Record<EstadoDoPlay, Forma> = {
  // Triângulo partido ao meio (deslocado meio ponto à direita, como o ícone
  // original: o peso visual do triângulo fica à esquerda).
  play: [
    reamostrar([
      [7.5, 5],
      [12.5, 7.9],
      [12.5, 16.1],
      [7.5, 19],
    ]),
    reamostrar([
      [12.5, 7.9],
      [19.5, 12],
      [19.5, 12.01],
      [12.5, 16.1],
    ]),
  ],
  pausa: [
    reamostrar([
      [6, 5],
      [10, 5],
      [10, 19],
      [6, 19],
    ]),
    reamostrar([
      [14, 5],
      [18, 5],
      [18, 19],
      [14, 19],
    ]),
  ],
  // O disco: duas metades de círculo, na mesma ordem dos outros polígonos.
  carregando: [
    reamostrar([...arco(R, -120, -90, 4), [12, 21], ...arco(R, 90, 240, 16)]),
    reamostrar([...arco(R, -90, 90, 20), [12, 21]]),
  ],
};

function caminho(p: readonly Ponto[]): string {
  let d = `M${p[0]![0].toFixed(2)} ${p[0]![1].toFixed(2)}`;
  for (let i = 1; i < p.length; i++) d += `L${p[i]![0].toFixed(2)} ${p[i]![1].toFixed(2)}`;
  return `${d}Z`;
}

const suave = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function IconeDoPlay({ estado, className }: { estado: EstadoDoPlay; className?: string }) {
  const semMovimento = useSemMovimento();
  const esquerda = useRef<SVGPathElement>(null);
  const direita = useRef<SVGPathElement>(null);
  /** A forma que está NA TELA agora (inclusive no meio de uma transição). */
  const atual = useRef<Forma>(FORMAS[estado]);

  useEffect(() => {
    const alvo = FORMAS[estado];
    const [e, d] = [esquerda.current, direita.current];
    if (!e || !d) return;
    const pintar = (f: Forma) => {
      e.setAttribute('d', caminho(f[0]));
      d.setAttribute('d', caminho(f[1]));
      atual.current = f;
    };
    if (semMovimento) {
      pintar(alvo);
      return;
    }
    // Parte de onde a figura ESTÁ — trocar no meio de uma transição não salta.
    const de = atual.current;
    const inicio = performance.now();
    let raf = 0;
    const quadro = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / DURACAO_MS);
      const k = suave(t);
      const mistura = (a: Ponto[], b: Ponto[]): Ponto[] =>
        a.map((p, i) => [p[0] + (b[i]![0] - p[0]) * k, p[1] + (b[i]![1] - p[1]) * k] as const);
      pintar([mistura(de[0], alvo[0]), mistura(de[1], alvo[1])]);
      if (t < 1) raf = requestAnimationFrame(quadro);
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
  }, [estado, semMovimento]);

  const inicial = FORMAS[estado];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('overflow-visible', className)}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
    >
      <path ref={esquerda} d={caminho(inicial[0])} />
      <path ref={direita} d={caminho(inicial[1])} />
      {/* Os sulcos do disco: só aparecem quando ele se forma, e giram a 33⅓. */}
      <g
        className={cn(
          'origin-center transition-opacity duration-200',
          estado === 'carregando' ? 'opacity-100' : 'opacity-0',
          estado === 'carregando' && !semMovimento && 'animate-[disco-gira_1.8s_linear_infinite]',
        )}
        fill="none"
        stroke="hsl(var(--accent))"
        strokeWidth={0.9}
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="6.2" strokeOpacity={0.45} />
        <path d="M12 5.2a6.8 6.8 0 0 1 6.8 6.8" strokeOpacity={0.9} />
        <circle cx="12" cy="12" r="1.7" fill="hsl(var(--accent))" stroke="none" />
      </g>
    </svg>
  );
}
