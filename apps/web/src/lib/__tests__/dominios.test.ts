import { describe, expect, it } from 'vitest';
import { migrarDominio } from '../dominios';

describe('migrarDominio', () => {
  it('leva a cópia do cofre do nexusholding para o radinho.online', () => {
    expect(migrarDominio('https://importer.nexusholding.xyz/blob/local%3Aabc?k=123')).toBe(
      'https://importer.radinho.online/blob/local%3Aabc?k=123',
    );
  });

  it('leva a API antiga para api.radinho.online', () => {
    expect(migrarDominio('https://aurial-api.nexusholding.xyz/api/v1/catalogo')).toBe(
      'https://api.radinho.online/api/v1/catalogo',
    );
  });

  it('não mexe em outros endereços nem em parecidos', () => {
    for (const url of [
      'https://audius.co/x',
      'https://importer.nexusholding.xyz.evil.com/blob/x',
      'https://outro.nexusholding.xyz/blob/x',
    ]) {
      expect(migrarDominio(url)).toBe(url);
    }
    expect(migrarDominio(null)).toBeNull();
  });
});
