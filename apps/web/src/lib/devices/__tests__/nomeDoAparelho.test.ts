import { describe, expect, it } from 'vitest';
import { nomeDoModelo, nomeDoNavegador } from '../presence';

describe('nome do aparelho', () => {
  it('traduz o código Samsung para o nome do modelo', () => {
    expect(nomeDoModelo('SM-G950F')).toBe('Galaxy S8');
    expect(nomeDoModelo('SM-A155M Build/UP1A')).toBe('Galaxy A15');
  });

  it('modelo fora da lista fica como veio', () => {
    expect(nomeDoModelo('moto g(60)')).toBe('moto g(60)');
    expect(nomeDoModelo('SM-X999Z')).toBe('SM-X999Z');
  });

  it('separa o navegador — duas entradas do mesmo PC deixam de parecer fantasmas', () => {
    const base = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
    expect(nomeDoNavegador(`${base} Chrome/128.0 Safari/537.36`)).toBe('Chrome');
    expect(nomeDoNavegador(`${base} Chrome/128.0 Safari/537.36 Edg/128.0`)).toBe('Edge');
    expect(
      nomeDoNavegador('Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Firefox');
    expect(
      nomeDoNavegador(
        'Mozilla/5.0 (Linux; Android 9; SM-G950F) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
      ),
    ).toBe('Samsung Internet');
  });
});
