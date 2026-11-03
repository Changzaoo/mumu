import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from '../../infra/http/remoteImage.js';
import { guardarComTeto } from './agora.js';

describe('guardarComTeto', () => {
  it('descarta as mais antigas ao passar do teto', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 5; i++) guardarComTeto(m, `k${i}`, i, 3);
    expect([...m.keys()]).toEqual(['k2', 'k3', 'k4']);
  });
  it('reinserir chave existente não estoura nem duplica', () => {
    const m = new Map<string, number>();
    guardarComTeto(m, 'a', 1, 2);
    guardarComTeto(m, 'b', 2, 2);
    guardarComTeto(m, 'a', 3, 2);
    expect([...m.entries()]).toEqual([
      ['b', 2],
      ['a', 3],
    ]);
  });
});

describe('isBlockedAddress NAT64', () => {
  it('bloqueia 64:ff9b::/96', () => {
    expect(isBlockedAddress('64:ff9b::a00:1')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
  });
});
