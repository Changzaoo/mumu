import { describe, expect, it } from 'vitest';
import {
  LIMIAR_PX,
  MAXIMO_PX,
  RESISTENCIA,
  decidirEixo,
  disparou,
  distanciaDaPuxada,
  podeComecar,
  progresso,
} from '@/lib/gestos/puxada';

const ALTURA = 800; // zona de início: y ≤ 160

describe('podeComecar', () => {
  it('um dedo, nos 20% de cima, com a página no topo', () => {
    expect(podeComecar({ y: 100, alturaDaTela: ALTURA, scrollTop: 0, toques: 1 })).toBe(true);
    expect(podeComecar({ y: 160, alturaDaTela: ALTURA, scrollTop: 0, toques: 1 })).toBe(true);
  });

  it('abaixo da zona de cima não é puxada — é rolagem', () => {
    expect(podeComecar({ y: 161, alturaDaTela: ALTURA, scrollTop: 0, toques: 1 })).toBe(false);
    expect(podeComecar({ y: 600, alturaDaTela: ALTURA, scrollTop: 0, toques: 1 })).toBe(false);
  });

  it('com a página rolada, puxar para baixo é voltar para cima', () => {
    expect(podeComecar({ y: 50, alturaDaTela: ALTURA, scrollTop: 40, toques: 1 })).toBe(false);
  });

  it('tolera o resto de meio pixel que o iOS deixa depois do quique', () => {
    expect(podeComecar({ y: 50, alturaDaTela: ALTURA, scrollTop: 0.33, toques: 1 })).toBe(true);
  });

  it('dois dedos é pinça', () => {
    expect(podeComecar({ y: 50, alturaDaTela: ALTURA, scrollTop: 0, toques: 2 })).toBe(false);
  });
});

describe('decidirEixo', () => {
  it('espera enquanto o dedo mal saiu do lugar', () => {
    expect(decidirEixo(2, 3)).toBe('espera');
  });

  it('para baixo e na vertical vira puxada', () => {
    expect(decidirEixo(2, 20)).toBe('puxar');
  });

  it('de lado é carrossel — desiste', () => {
    expect(decidirEixo(20, 5)).toBe('desistir');
    expect(decidirEixo(-20, 5)).toBe('desistir');
  });

  it('na diagonal exata também desiste (a prateleira tem prioridade)', () => {
    expect(decidirEixo(15, 15)).toBe('desistir');
  });

  it('para cima é rolagem comum — desiste', () => {
    expect(decidirEixo(0, -20)).toBe('desistir');
  });
});

describe('distância e gatilho', () => {
  it('o indicador anda menos que o dedo e para no máximo', () => {
    expect(distanciaDaPuxada(100)).toBe(100 * RESISTENCIA);
    expect(distanciaDaPuxada(10_000)).toBe(MAXIMO_PX);
    expect(distanciaDaPuxada(-30)).toBe(0);
  });

  it('só dispara ao passar do limiar', () => {
    const dedoNoLimiar = LIMIAR_PX / RESISTENCIA;
    expect(disparou(distanciaDaPuxada(dedoNoLimiar - 2))).toBe(false);
    expect(disparou(distanciaDaPuxada(dedoNoLimiar))).toBe(true);
  });

  it('o progresso do círculo vai de 0 a 1 e não passa disso', () => {
    expect(progresso(0)).toBe(0);
    expect(progresso(LIMIAR_PX / 2)).toBeCloseTo(0.5);
    expect(progresso(MAXIMO_PX)).toBe(1);
  });
});
