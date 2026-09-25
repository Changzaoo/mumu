import { describe, expect, it } from 'vitest';
import { transformInverso, type Caixa } from '@/lib/perf/giroDeTela';

const caixa = (left: number, top: number, width: number, height: number): Caixa => ({
  left,
  top,
  width,
  height,
});

const numeros = (t: string): number[] => (t.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('transformInverso', () => {
  it('põe a peça de volta onde ela estava', () => {
    // Card que estava em (20, 300) e, deitado, foi para (400, 120).
    const t = transformInverso(caixa(20, 300, 160, 200), caixa(400, 120, 160, 200), 'item');
    expect(numeros(t ?? '')).toEqual([-380, 180, 1, 1]);
  });

  it('barra pode esticar em cada eixo, como a do iOS', () => {
    // Mini player de 390x64 que virou barra de 844x88.
    const t = transformInverso(caixa(0, 600, 390, 64), caixa(0, 302, 844, 88), 'barra');
    const [, , sx, sy] = numeros(t ?? '');
    expect(sx).toBeCloseTo(390 / 844, 3);
    expect(sy).toBeCloseTo(64 / 88, 3);
  });

  it('item escala por igual — texto não distorce no caminho', () => {
    const t = transformInverso(caixa(0, 0, 100, 200), caixa(0, 0, 200, 200), 'item');
    const [, , sx, sy] = numeros(t ?? '');
    expect(sx).toBeCloseTo(sy as number, 6);
  });

  it('escala absurda é limitada: vira movimento, não borrão', () => {
    const t = transformInverso(caixa(0, 0, 1000, 1000), caixa(0, 0, 10, 10), 'barra');
    const [, , sx, sy] = numeros(t ?? '');
    expect(sx).toBe(3);
    expect(sy).toBe(3);
  });

  it('peça que não se mexeu não anima', () => {
    expect(transformInverso(caixa(10, 10, 50, 50), caixa(10, 10, 50, 50), 'item')).toBeNull();
  });

  it('medida podre (sem tamanho) não anima', () => {
    expect(transformInverso(caixa(0, 0, 0, 0), caixa(10, 10, 50, 50), 'item')).toBeNull();
  });
});
