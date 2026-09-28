import { describe, expect, it } from 'vitest';
import { perfilDoHardware, qualidadeDaRede } from '../dispositivo';
import { antecedenciaDoPreload, qualidadeEfetiva, qualidadeRecomendada } from '../adaptacao';

const nav = (hardwareConcurrency: number, deviceMemory?: number) =>
  ({ hardwareConcurrency, deviceMemory }) as Navigator & { deviceMemory?: number };

describe('perfil do aparelho', () => {
  it('entrada: poucos núcleos ou pouca memória', () => {
    expect(perfilDoHardware(nav(2, 8))).toBe('baixo');
    expect(perfilDoHardware(nav(8, 2))).toBe('baixo');
  });
  it('meio da pirâmide: 4–6 GB / 4–8 núcleos', () => {
    expect(perfilDoHardware(nav(8, 4))).toBe('medio');
    expect(perfilDoHardware(nav(4, 8))).toBe('medio');
  });
  it('topo, e Apple (sem deviceMemory) com 6+ núcleos', () => {
    expect(perfilDoHardware(nav(8, 8))).toBe('alto');
    expect(perfilDoHardware(nav(6))).toBe('alto');
  });
  it('navegador que não conta nada não é rebaixado', () => {
    expect(perfilDoHardware(nav(0))).toBe('alto');
  });
});

describe('rede', () => {
  it('sem a API: não castiga', () => expect(qualidadeDaRede(undefined)).toBe('rapida'));
  it('economia de dados vale mais que a medida', () =>
    expect(qualidadeDaRede({ effectiveType: '4g', saveData: true })).toBe('lenta'));
  it('2g lenta, 3g ou downlink baixo média', () => {
    expect(qualidadeDaRede({ effectiveType: '2g' })).toBe('lenta');
    expect(qualidadeDaRede({ effectiveType: '3g' })).toBe('media');
    expect(qualidadeDaRede({ effectiveType: '4g', downlink: 0.8 })).toBe('media');
    expect(qualidadeDaRede({ effectiveType: '4g', downlink: 10 })).toBe('rapida');
  });
});

describe('adaptação', () => {
  it('recomenda pela rede e pelo aparelho', () => {
    expect(qualidadeRecomendada('alto', 'lenta')).toBe('low');
    expect(qualidadeRecomendada('alto', 'media')).toBe('normal');
    expect(qualidadeRecomendada('baixo', 'rapida')).toBe('normal');
    expect(qualidadeRecomendada('alto', 'rapida')).toBe('high');
  });
  it('a escolha da pessoa é teto: automático só baixa, nunca sobe', () => {
    expect(qualidadeEfetiva('high', true, 'alto', 'lenta')).toBe('low');
    expect(qualidadeEfetiva('low', true, 'alto', 'rapida')).toBe('low');
    expect(qualidadeEfetiva('lossless', true, 'alto', 'rapida')).toBe('high');
  });
  it('automático desligado respeita a escolha', () => {
    expect(qualidadeEfetiva('high', false, 'baixo', 'lenta')).toBe('high');
  });
  it('rede lenta pré-carrega mais cedo', () => {
    expect(antecedenciaDoPreload('lenta')).toBeGreaterThan(antecedenciaDoPreload('rapida'));
  });
});
