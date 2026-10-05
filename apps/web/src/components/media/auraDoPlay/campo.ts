/**
 * O DESENHO DA NÉVOA — um campo de densidade por pixel, escrito direto num
 * `Uint8ClampedArray` RGBA (o ImageData que o chamador reaproveita). Não toca
 * em DOM nem em canvas; só números. A decisão do que desenhar vem da máquina
 * (`maquina.ts`); aqui só se transforma parâmetros em pixels.
 *
 * COMO A NÉVOA É FEITA: amostra POLAR (o ângulo percorre um círculo do ruído, a
 * distância à borda do botão é a terceira coordenada, deslocada pelo `fluxo`),
 * com o domínio distorcido por outro ruído — o que enrola e rasga as línguas —
 * e o tempo como QUARTA entrada (`t`), então o desenho nunca se repete. A
 * semente da faixa muda o ruído inteiro e o plano onde se amostra.
 *
 * SUGAR: quando `suga` > 0 a coordenada radial é DEFORMADA (fora + 1,6·fora²):
 * as línguas correm para dentro cada vez mais depressa à medida que se
 * aproximam do botão, como água descendo pelo ralo, e o braço da espiral se
 * aperta.
 */
import { fbm, fbm2, type CampoDaFaixa } from './ruido';

export interface Geometria {
  n: number;
  raio: Float32Array;
  x: Float32Array;
  y: Float32Array;
  cos: Float32Array;
  sen: Float32Array;
  theta: Float32Array;
}

/** Raio e ângulo de cada pixel, calculados UMA vez. */
export function criarGeometria(n: number): Geometria {
  const g: Geometria = {
    n,
    raio: new Float32Array(n * n),
    x: new Float32Array(n * n),
    y: new Float32Array(n * n),
    cos: new Float32Array(n * n),
    sen: new Float32Array(n * n),
    theta: new Float32Array(n * n),
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 2 - 1;
      const y = ((j + 0.5) / n) * 2 - 1;
      const k = j * n + i;
      g.x[k] = x;
      g.y[k] = y;
      const r = Math.hypot(x, y);
      g.raio[k] = r;
      const rr = r || 1e-3;
      g.cos[k] = x / rr;
      g.sen[k] = y / rr;
      g.theta[k] = Math.atan2(y, x);
    }
  }
  return g;
}

export interface QuadroDaNevoa {
  /** Ângulo do guia (rad); o desenho gira junto. */
  ang: number;
  t: number;
  fluxo: number;
  viva: number;
  suga: number;
  giro: number;
  densidade: number;
  /** Beira do anel (fração do raio). */
  raio: number;
  opacidade: number;
  /** Vento (só parada). */
  vx: number;
  vy: number;
  ventoX: number;
  ventoY: number;
  /** Borda do botão (fração do raio da caixa). */
  borda: number;
  cor: readonly [number, number, number];
  /** Opacidade máxima (0–255), conforme a cor. */
  teto: number;
  /** Força do braço do tornado 0..1 (0 = névoa difusa, sem guia). */
  braco: number;
  /** Aperto da espiral (rad por unidade de raio). */
  espiral: number;
}

/** Comprimento da cauda atrás do braço (rad). */
const CAUDA = 2.2;
const DOIS_PI = Math.PI * 2;
const ESPIRAL_BASE = 7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function espiralDe(suga: number): number {
  return ESPIRAL_BASE * (1 + 0.5 * suga);
}

/** Pinta o campo em `px` (RGBA, n·n·4). Não aloca. */
export function pintarCampo(
  px: Uint8ClampedArray,
  geo: Geometria,
  campo: CampoDaFaixa,
  q: QuadroDaNevoa,
): void {
  const { ruido, ox, oy } = campo;
  const total = geo.n * geo.n;
  const cosA = Math.cos(q.ang);
  const senA = Math.sin(q.ang);
  // A cabeça do braço: o anel começa com ela no topo (12 h) = −π/2 no canvas.
  const cabeca = q.ang - Math.PI / 2;
  const forcaDoBraco = q.braco;
  const [r, g, b] = q.cor;
  const borda = q.borda;
  const beira = q.raio;
  // Mais denso → limiar menor (mais névoa passa); o acúmulo pesa perto do botão.
  const bonus = (q.densidade - 0.5) * 2;
  const mexe = q.t;
  const espiral = q.espiral;
  for (let k = 0; k < total; k++) {
    const raio = geo.raio[k]!;
    const janela =
      smooth(borda - 0.08, borda + 0.04, raio) * (1 - smooth(borda + 0.05, beira, raio));
    const o = k * 4;
    if (janela <= 0.001) {
      px[o + 3] = 0;
      continue;
    }
    const c = geo.cos[k]!;
    const sn = geo.sen[k]!;
    const fora = raio - borda;
    // Sugada, a coordenada radial é deformada: velocidade ∝ 1/(1 + 3,2·fora),
    // maior perto do botão — o puxão acelera ao se aproximar.
    const foraR = fora + q.suga * 1.6 * fora * fora;
    const ca = c * cosA + sn * senA;
    const sa = sn * cosA - c * senA;
    const sx = ca * 2.3 + ox - q.ventoX;
    const sy = sa * 2.3 + oy - q.ventoY;
    const sz = foraR * 4.4 - q.fluxo;
    const wx = fbm2(ruido, sx * 0.8, sy * 0.8, sz * 0.5 + mexe * 0.6);
    const wy = fbm2(ruido, sx * 0.8 + 5.2, sy * 0.8 + 1.3, sz * 0.5 + mexe * 0.6 + 3.1);
    const d = fbm(ruido, sx + 1.9 * wx, sy + 1.9 * wy, sz + mexe);
    const inclina = 1 + (geo.x[k]! * q.vx + geo.y[k]! * q.vy) * 0.55 * (1 - q.suga);
    const afina = fora * (0.95 - 0.55 * q.viva + 0.4 * q.suga);
    const atras =
      (((cabeca - espiral * Math.max(0, fora) - geo.theta[k]!) % DOIS_PI) + DOIS_PI) % DOIS_PI;
    const braco = Math.exp(-atras / CAUDA);
    const guia = 1 - forcaDoBraco + forcaDoBraco * braco;
    // Acúmulo: a densidade extra se concentra colada ao botão.
    const perto = 1 - smooth(0, 0.3, fora);
    const dens =
      Math.max(
        0,
        Math.min(
          1,
          (d - 0.36 - afina + 0.24 * braco * forcaDoBraco + 0.14 * bonus * (0.4 + perto)) *
            (4 + 1.5 * q.suga) *
            inclina,
        ),
      ) *
      janela *
      guia;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = Math.round(dens * q.opacidade * q.teto);
  }
}

/**
 * Suaviza o canal alfa (caixa 3×3, `passes` vezes) — é o "desfoque" do modo
 * leve, assado UMA vez no bitmap: as camadas giram por transform sem filtro
 * nenhum por quadro. `tmp` tem o tamanho de `px`.
 */
export function suavizarAlfa(
  px: Uint8ClampedArray,
  n: number,
  tmp: Uint8ClampedArray,
  passes = 2,
): void {
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let soma = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= n) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= n) continue;
            soma += px[(jj * n + ii) * 4 + 3]!;
          }
        }
        tmp[(j * n + i) * 4 + 3] = soma / 9;
      }
    }
    for (let k = 3; k < px.length; k += 4) px[k] = tmp[k]!;
  }
}
