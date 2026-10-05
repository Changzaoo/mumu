/**
 * RUÍDO DA NÉVOA — contínuo no tempo (o tempo é a 3ª dimensão), sem tabela e
 * sem período, e com SEMENTE por faixa.
 *
 * Por que sem tabela: o ruído com `& 255` na rede repete a cada 256 unidades de
 * cada eixo — com o tempo andando como terceiro eixo, a névoa voltava ao mesmo
 * desenho depois de ~20 minutos. Aqui o valor de cada vértice da rede vem de um
 * hash de inteiros de 32 bits (coordenadas + semente): não há ciclo no uso real
 * (2³² células) e nada a alocar.
 */

/** Hash de texto (xmur3 reduzido): o id da faixa vira um inteiro de 32 bits. */
export function hashDeTexto(texto: string): number {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Sequência pseudoaleatória com semente (mulberry32). */
export function sequencia(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Ruido3D = (x: number, y: number, z: number) => number;

/** Campo de ruído de UMA faixa: o ruído e os deslocamentos que só ela tem. */
export interface CampoDaFaixa {
  semente: number;
  ruido: Ruido3D;
  /** Deslocamento do plano da névoa (cada faixa olha para outra região do ruído). */
  ox: number;
  oy: number;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Ruído de valor 3D, suave (fade quíntico), 0..1, com hash inteiro nos vértices. */
export function criarRuido(semente: number): Ruido3D {
  const s = semente | 0;
  const h = (x: number, y: number, z: number): number => {
    let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x85ebca6b) ^ s;
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  };
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const a = h(xi, yi, zi);
    const b = h(xi + 1, yi, zi);
    const c = h(xi, yi + 1, zi);
    const d = h(xi + 1, yi + 1, zi);
    const e = h(xi, yi, zi + 1);
    const f = h(xi + 1, yi, zi + 1);
    const g = h(xi, yi + 1, zi + 1);
    const k = h(xi + 1, yi + 1, zi + 1);
    const ab = a + (b - a) * u;
    const cd = c + (d - c) * u;
    const ef = e + (f - e) * u;
    const gk = g + (k - g) * u;
    const z0 = ab + (cd - ab) * v;
    const z1 = ef + (gk - ef) * v;
    return z0 + (z1 - z0) * w;
  };
}

/** O campo da faixa: mesma semente (id) → o mesmo campo, em qualquer aparelho. */
export function campoDaFaixa(faixa: string): CampoDaFaixa {
  const semente = hashDeTexto(faixa || 'radinho');
  const sorteio = sequencia(semente ^ 0x9e3779b9);
  return {
    semente,
    ruido: criarRuido(semente),
    ox: 20 + sorteio() * 400,
    oy: 20 + sorteio() * 400,
  };
}

/** Três oitavas: grande forma + fiapos. 0..1. */
export function fbm(r: Ruido3D, x: number, y: number, z: number): number {
  return (
    r(x, y, z) * 0.57 +
    r(x * 2.03 + 17.1, y * 2.03 - 9.3, z * 1.7) * 0.29 +
    r(x * 4.11 - 31.7, y * 4.11 + 5.2, z * 2.9) * 0.14
  );
}

/** Duas oitavas, para a DISTORÇÃO do domínio (a terceira se perderia no desfoque). */
export function fbm2(r: Ruido3D, x: number, y: number, z: number): number {
  return r(x, y, z) * 0.66 + r(x * 2.03 + 17.1, y * 2.03 - 9.3, z * 1.7) * 0.34;
}
