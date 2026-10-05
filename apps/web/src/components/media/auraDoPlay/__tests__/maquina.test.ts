import { describe, expect, it } from 'vitest';
import {
  avancar,
  emRepouso,
  estadoInicial,
  VEL_CD,
  type EstadoDaNevoa,
  type SinaisDaNevoa,
} from '../maquina';

const DT = 1 / 30;
const base: SinaisDaNevoa = {
  tocando: false,
  carregando: false,
  semMovimento: false,
  faixa: 'faixa-a',
  posicao: null,
  rajada: 0.5,
};

/** Roda `seg` segundos com `s`; chama `ver` a cada quadro com o estado anterior e o novo. */
function rodar(
  e: EstadoDaNevoa,
  s: SinaisDaNevoa,
  seg: number,
  ver?: (antes: EstadoDaNevoa, depois: EstadoDaNevoa) => void,
): EstadoDaNevoa {
  let atual = e;
  const quadros = Math.round(seg / DT);
  for (let i = 0; i < quadros; i++) {
    const proximo = avancar(atual, s, DT);
    ver?.(atual, proximo);
    atual = proximo;
  }
  return atual;
}

/** Nenhuma grandeza que o olho vê salta mais que o limiar entre dois quadros. */
function semSalto(a: EstadoDaNevoa, b: EstadoDaNevoa): void {
  expect(Math.abs(b.suga - a.suga)).toBeLessThan(0.06);
  expect(Math.abs(b.giro - a.giro)).toBeLessThan(0.06);
  expect(Math.abs(b.viva - a.viva)).toBeLessThan(0.06);
  expect(Math.abs(b.vis - a.vis)).toBeLessThan(0.08);
  expect(Math.abs(b.densidade - a.densidade)).toBeLessThan(0.04);
  expect(Math.abs(b.raio - a.raio)).toBeLessThan(0.03);
  expect(Math.abs(b.opacidade - a.opacidade)).toBeLessThan(0.08);
  expect(Math.abs(b.velRadial - a.velRadial)).toBeLessThan(0.2);
  expect(Math.abs(b.velAngular - a.velAngular)).toBeLessThan(0.35);
  // O ângulo anda no máximo na velocidade do guia (+ correção de fase) por quadro.
  expect(b.ang - a.ang).toBeGreaterThanOrEqual(0);
  expect(b.ang - a.ang).toBeLessThan((VEL_CD + 1.5) * DT);
}

describe('máquina da névoa — estados', () => {
  it('baixando: a névoa é SUGADA (velocidade radial para dentro, anel contraído, ease-in)', () => {
    let e = estadoInicial({ ...base, tocando: true, carregando: true });
    expect(e.fase).toBe('repouso'); // ainda não avançou
    const passos: number[] = [];
    e = rodar(e, { ...base, tocando: true, carregando: true }, 0.2, (_, d) => passos.push(d.suga));
    // Arranca devagar: ease-in (a sucção não começa no máximo).
    expect(passos[0]).toBeLessThan(0.02);
    expect(e.fase).toBe('reunindo');
    e = rodar(e, { ...base, tocando: true, carregando: true }, 3);
    expect(e.suga).toBe(1);
    expect(e.velRadial).toBeLessThan(-1);
    expect(e.raio).toBeLessThan(0.9);
    expect(e.densidade).toBeGreaterThan(0.95);
  });

  it('a névoa SURGE: não aparece de estalo — a sucção e a densidade sobem do repouso', () => {
    const e0 = estadoInicial({ ...base, tocando: true, carregando: true });
    expect(e0.suga).toBe(0);
    const e1 = avancar(e0, { ...base, tocando: true, carregando: true }, DT);
    expect(e1.suga - e0.suga).toBeLessThan(0.02);
    expect(Math.abs(e1.opacidade - e0.opacidade)).toBeLessThan(0.01);
  });

  it('tocando: gira no ritmo do guia (1,8 s por volta), sem sucção', () => {
    let e = estadoInicial({ ...base, tocando: true, carregando: true });
    e = rodar(e, { ...base, tocando: true, carregando: true }, 3);
    e = rodar(e, { ...base, tocando: true }, 3);
    expect(e.fase).toBe('girando');
    expect(e.suga).toBe(0);
    expect(e.velAngular).toBeCloseTo(VEL_CD, 5);
    expect(e.velRadial).toBeGreaterThan(0);
  });

  it('pausado: desacelera suave até o repouso e dorme', () => {
    let e = estadoInicial({ ...base, tocando: true });
    expect(emRepouso(e, { ...base, tocando: true })).toBe(false);
    e = rodar(e, base, 0.5);
    expect(e.fase).toBe('assentando');
    expect(e.velAngular).toBeGreaterThan(0);
    expect(e.velAngular).toBeLessThan(VEL_CD);
    e = rodar(e, base, 15);
    expect(e.fase).toBe('repouso');
    expect(e.velAngular).toBe(0);
    expect(emRepouso(e, base)).toBe(true);
  });

  it('dorme e acorda nas condições certas', () => {
    const parado = estadoInicial(base);
    expect(emRepouso(parado, base)).toBe(true);
    expect(emRepouso(parado, { ...base, tocando: true })).toBe(false);
    expect(emRepouso(parado, { ...base, carregando: true })).toBe(false);
    // Trocou a faixa com tudo parado: há o que fazer (dissipar e reunir).
    expect(emRepouso(parado, { ...base, faixa: 'outra' })).toBe(false);
    // Reduced-motion: sempre em repouso.
    expect(emRepouso(estadoInicial(base), { ...base, semMovimento: true, tocando: true })).toBe(
      true,
    );
  });

  it('sem movimento: estático, parâmetros fixos para qualquer dt e sinal', () => {
    const s = { ...base, semMovimento: true, tocando: true, carregando: true };
    const e0 = avancar(estadoInicial(s), s, 0);
    const e1 = rodar(e0, s, 2);
    expect(e0.fase).toBe('estatica');
    expect(e1.fase).toBe('estatica');
    expect(e1.velAngular).toBe(0);
    expect(e1.ang).toBe(e0.ang);
    expect(e1.fluxo).toBe(e0.fluxo);
    expect(e1.t).toBe(e0.t);
    expect(e1.opacidade).toBe(e0.opacidade);
    expect(e1.suga).toBe(0);
  });
});

describe('máquina da névoa — transições contínuas (sem salto entre quadros)', () => {
  it('repouso → baixando → tocando → pausado → repouso', () => {
    let e = estadoInicial(base);
    e = rodar(e, { ...base, tocando: true, carregando: true }, 4, semSalto);
    e = rodar(e, { ...base, tocando: true }, 4, semSalto); // o som saiu
    e = rodar(e, base, 14, semSalto); // pausou
    expect(e.fase).toBe('repouso');
  });

  it('baixando → tocando: a sucção vira giro no mesmo intervalo (~0,75 s), velocidade angular sem queda', () => {
    let e = estadoInicial(base);
    e = rodar(e, { ...base, tocando: true, carregando: true }, 4);
    const omega0 = e.velAngular;
    let menor = Infinity;
    let i = 0;
    let suga50: number | null = null;
    e = rodar(e, { ...base, tocando: true }, 1.2, (_a, d) => {
      i++;
      menor = Math.min(menor, d.velAngular);
      if (suga50 === null && d.suga < 0.5) suga50 = i * DT;
    });
    // A velocidade angular nunca despenca no meio da troca (sucção sai, giro entra).
    expect(menor).toBeGreaterThan(Math.min(omega0, VEL_CD) * 0.85);
    expect(suga50).not.toBeNull();
    expect(suga50!).toBeGreaterThan(0.2);
    expect(suga50!).toBeLessThan(0.9);
    expect(e.suga).toBeLessThan(0.25);
  });

  it('troca de faixa tocando: dissipa, troca a semente com a névoa invisível, reúne a nova', () => {
    let e = estadoInicial({ ...base, tocando: true });
    e = rodar(e, { ...base, tocando: true }, 2);
    expect(e.faixa).toBe('faixa-a');
    const nova = { ...base, tocando: true, faixa: 'faixa-b' };
    let opacidadeNaTroca = -1;
    const fases = new Set<string>();
    e = rodar(e, nova, 5, (a, d) => {
      semSalto(a, d);
      fases.add(d.fase);
      if (a.faixa !== d.faixa) opacidadeNaTroca = a.opacidade;
    });
    expect(e.faixa).toBe('faixa-b');
    // No instante em que a semente trocou, a névoa já estava (quase) invisível.
    expect(opacidadeNaTroca).toBeGreaterThanOrEqual(0);
    expect(opacidadeNaTroca).toBeLessThan(0.1);
    expect(fases.has('dissipando')).toBe(true);
    expect(fases.has('reunindo')).toBe(true); // volta ao estado 1
    expect(e.fase).toBe('girando');
    expect(e.vis).toBe(1);
  });

  it('troca de faixa pausado: dissipa, reúne e assenta de novo', () => {
    let e = estadoInicial(base);
    e = rodar(e, { ...base, faixa: 'faixa-b' }, 25, semSalto);
    expect(e.faixa).toBe('faixa-b');
    expect(e.fase).toBe('repouso');
  });

  it('trava de fase no relógio da música corrige devagar (sem arrancada)', () => {
    let e = estadoInicial({ ...base, tocando: true });
    e = rodar(e, { ...base, tocando: true }, 2);
    // A música está num ponto qualquer: o guia vai até a fase dela, com correção limitada.
    e = rodar(e, { ...base, tocando: true, posicao: 123.4 }, 8, semSalto);
    const alvo = 123.4 * VEL_CD;
    const dif = ((((alvo - e.ang) % (Math.PI * 2)) + 3 * Math.PI) % (Math.PI * 2)) - Math.PI;
    expect(Math.abs(dif)).toBeLessThan(0.35);
  });

  it('dt gigante (aba que voltou) não salta: o passo é limitado', () => {
    const e0 = estadoInicial({ ...base, tocando: true });
    const e1 = avancar(e0, { ...base, tocando: true }, 30);
    expect(e1.ang - e0.ang).toBeLessThan(VEL_CD * 0.06);
  });
});

describe('máquina da névoa — pureza', () => {
  it('não muda o estado anterior e é determinística', () => {
    const s = { ...base, tocando: true, carregando: true };
    const e0 = estadoInicial(s);
    const copia = JSON.stringify(e0);
    const a = avancar(e0, s, DT);
    const b = avancar(e0, s, DT);
    expect(JSON.stringify(e0)).toBe(copia);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('cada faixa parte de um ponto diferente; a mesma faixa, do mesmo', () => {
    const a = estadoInicial({ ...base, faixa: 'x' });
    const a2 = estadoInicial({ ...base, faixa: 'x' });
    const b = estadoInicial({ ...base, faixa: 'y' });
    expect(a.t).toBe(a2.t);
    expect(a.t).not.toBe(b.t);
  });
});
