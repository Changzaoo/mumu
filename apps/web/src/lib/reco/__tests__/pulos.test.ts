/**
 * PULAR NÃO É NÃO GOSTAR — o pulo rebaixa, esquece com o tempo e é perdoado
 * quando a pessoa volta a ouvir. Estes testes prendem as três coisas.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTrack } from '@/test/factories';
import {
  FATOR_MINIMO,
  fatorDePulo,
  lerPulos,
  perdoarPulos,
  registrarPulo,
  type Pulo,
} from '@/lib/reco/pulos';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = 1_800_000_000_000;

const faixa = (id: string, artista = 'Matuê') =>
  makeTrack(id, { artists: [{ id: 'a', name: artista, slug: '', imageUrl: null }] });

const pulo = (id: string, diasAtras: number, fracao = 0.1, artista = 'matue'): Pulo => ({
  id,
  artista,
  em: AGORA - diasAtras * DIA,
  fracao,
});

describe('fatorDePulo', () => {
  it('sem pulo, a faixa vale inteira', () => {
    expect(fatorDePulo(faixa('x'), [], AGORA)).toBe(1);
  });

  it('pulada hoje, desce — mas não some', () => {
    const f = fatorDePulo(faixa('x'), [pulo('x', 0)], AGORA);
    expect(f).toBeLessThan(0.6);
    expect(f).toBeGreaterThanOrEqual(FATOR_MINIMO);
  });

  it('pular muitas vezes nunca passa do piso: rebaixa, não exclui', () => {
    const muitos = Array.from({ length: 30 }, () => pulo('x', 0));
    expect(fatorDePulo(faixa('x'), muitos, AGORA)).toBe(FATOR_MINIMO);
  });

  it('esquece com o tempo: um mês depois quase não pesa', () => {
    const hoje = fatorDePulo(faixa('x'), [pulo('x', 0)], AGORA);
    const semana = fatorDePulo(faixa('x'), [pulo('x', 7)], AGORA);
    const mes = fatorDePulo(faixa('x'), [pulo('x', 30)], AGORA);
    expect(semana).toBeGreaterThan(hoje);
    expect(mes).toBeGreaterThan(0.95);
  });

  it('pular no começo pesa mais que pular perto do fim', () => {
    const cedo = fatorDePulo(faixa('x'), [pulo('x', 0, 0.05)], AGORA);
    const tarde = fatorDePulo(faixa('x'), [pulo('x', 0, 0.8)], AGORA);
    expect(cedo).toBeLessThan(tarde);
  });

  it('o artista sente de leve: pular uma dele não enterra as outras', () => {
    const outraDoMesmo = fatorDePulo(faixa('y'), [pulo('x', 0)], AGORA);
    expect(outraDoMesmo).toBeGreaterThan(0.8);
    expect(outraDoMesmo).toBeLessThan(1);
  });
});

describe('registro no aparelho', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('faixa que não chegou a soar não conta como pulo', () => {
    const antes = lerPulos().length;
    registrarPulo(faixa('morta'), 0, 180);
    expect(lerPulos().length).toBe(antes);
  });

  it('pular no finzinho é o mesmo que ter ouvido', () => {
    const antes = lerPulos().length;
    registrarPulo(faixa('quase'), 175, 180);
    expect(lerPulos().length).toBe(antes);
  });

  it('ouvir de novo perdoa o pulo', () => {
    registrarPulo(faixa('volta'), 10, 180);
    expect(lerPulos().some((p) => p.id === 'volta')).toBe(true);
    perdoarPulos('volta');
    expect(lerPulos().some((p) => p.id === 'volta')).toBe(false);
  });
});
