import { describe, expect, it } from 'vitest';
import { criarGeometria, espiralDe, pintarCampo, type QuadroDaNevoa } from '../campo';
import { campoDaFaixa, hashDeTexto, criarRuido } from '../ruido';

const N = 48;
const geo = criarGeometria(N);
const quadro = (sobre: Partial<QuadroDaNevoa> = {}): QuadroDaNevoa => ({
  ang: 0.3,
  t: 12,
  fluxo: 7,
  viva: 1,
  suga: 0,
  giro: 1,
  densidade: 1,
  raio: 0.98,
  opacidade: 1,
  vx: 0,
  vy: 0,
  ventoX: 0,
  ventoY: 0,
  borda: 0.54,
  cor: [255, 255, 255],
  teto: 230,
  braco: 1,
  espiral: espiralDe(0),
  ...sobre,
});
const pintar = (faixa: string, q: QuadroDaNevoa) => {
  const px = new Uint8ClampedArray(N * N * 4);
  pintarCampo(px, geo, campoDaFaixa(faixa), q);
  return px;
};
const alfa = (px: Uint8ClampedArray) => {
  const a: number[] = [];
  for (let i = 3; i < px.length; i += 4) a.push(px[i]!);
  return a;
};
const diferenca = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
};

describe('campo da névoa', () => {
  it('mesma semente (id da faixa) → exatamente o mesmo campo', () => {
    expect(alfa(pintar('t1', quadro()))).toEqual(alfa(pintar('t1', quadro())));
  });

  it('faixas diferentes → campos diferentes', () => {
    const a = alfa(pintar('t1', quadro()));
    const b = alfa(pintar('t2', quadro()));
    expect(diferenca(a, b)).toBeGreaterThan(2);
  });

  it('o tempo é uma dimensão do ruído: dois instantes distantes não repetem o desenho', () => {
    const a = alfa(pintar('t1', quadro({ t: 10 })));
    for (const t of [10.5, 40, 300, 1300, 5000]) {
      expect(diferenca(a, alfa(pintar('t1', quadro({ t }))))).toBeGreaterThan(3);
    }
  });

  it('sem período de rede: o ruído não repete a cada 256 unidades', () => {
    const r = criarRuido(hashDeTexto('t1'));
    let iguais = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 + 0.11;
      if (Math.abs(r(x, 1.3, 2.9) - r(x + 256, 1.3, 2.9)) < 1e-9) iguais++;
      if (Math.abs(r(x, 1.3, 2.9) - r(x, 1.3, 2.9 + 256)) < 1e-9) iguais++;
    }
    expect(iguais).toBe(0);
  });

  it('o ruído é suave e fica em 0..1', () => {
    const r = criarRuido(7);
    let max = 0;
    for (let i = 0; i < 2000; i++) {
      const v = r(i * 0.013, 3.1, 0.4);
      const w = r(i * 0.013 + 0.013, 3.1, 0.4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      max = Math.max(max, Math.abs(v - w));
    }
    expect(max).toBeLessThan(0.05);
  });

  it('sem quadrado visível: a borda da caixa é transparente e o centro (botão) também', () => {
    const px = pintar('t1', quadro({ giro: 1 }));
    const a = alfa(px);
    for (let k = 0; k < N * N; k++) {
      if (geo.raio[k]! > 0.995 || geo.raio[k]! < 0.4) expect(a[k]).toBe(0);
    }
    // E há névoa de verdade no anel.
    expect(a.filter((v) => v > 40).length).toBeGreaterThan(80);
  });

  it('sugada, a névoa se contrai: menos densidade na beira de fora', () => {
    const solta = alfa(pintar('t1', quadro({ suga: 0, raio: 0.98 })));
    const suga = alfa(pintar('t1', quadro({ suga: 1, raio: 0.76 })));
    let fora1 = 0;
    let fora2 = 0;
    for (let k = 0; k < N * N; k++) {
      if (geo.raio[k]! > 0.8) {
        fora1 += solta[k]!;
        fora2 += suga[k]!;
      }
    }
    expect(fora2).toBeLessThan(fora1 * 0.4);
  });
});
