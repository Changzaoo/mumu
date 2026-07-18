import { describe, expect, it } from 'vitest';
import { isCatalogId, isCatalogTrack, isOwnTrack } from '@/lib/catalog/isCatalogTrack';

describe('isCatalogId', () => {
  it('reconhece os prefixos do catálogo grátis', () => {
    expect(isCatalogId('audius:abc123')).toBe(true);
    expect(isCatalogId('apple:987')).toBe(true);
  });

  it('não confunde faixa do usuário nem id vazio', () => {
    expect(isCatalogId('local:uuid-1')).toBe(false);
    expect(isCatalogId('')).toBe(false);
    expect(isCatalogId(null)).toBe(false);
    expect(isCatalogId(undefined)).toBe(false);
  });

  it('exige o prefixo, não a substring', () => {
    expect(isCatalogId('local:audius:1')).toBe(false);
  });
});

describe('isCatalogTrack / isOwnTrack', () => {
  it('classifica por id', () => {
    expect(isCatalogTrack({ id: 'audius:1' })).toBe(true);
    expect(isCatalogTrack({ id: 'apple:1' })).toBe(true);
    expect(isCatalogTrack({ id: 'local:1' })).toBe(false);
  });

  it('trata prévia de 30s como catálogo mesmo com id local', () => {
    expect(isCatalogTrack({ id: 'local:1', previewOnly: true })).toBe(true);
  });

  it('isOwnTrack é o complemento exato', () => {
    for (const track of [
      { id: 'audius:1' },
      { id: 'apple:1' },
      { id: 'local:1' },
      { id: 'local:2', previewOnly: true },
    ]) {
      expect(isOwnTrack(track)).toBe(!isCatalogTrack(track));
    }
  });
});
