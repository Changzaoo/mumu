import { describe, expect, it } from 'vitest';
import { urlSemSegredos } from './urlSemSegredos.js';

describe('urlSemSegredos', () => {
  it('mascara token, k, key e authorization', () => {
    expect(urlSemSegredos('/stream/a/manifest.m3u8?token=123.abc&x=1')).toBe(
      '/stream/a/manifest.m3u8?token=[redigido]&x=1',
    );
    expect(urlSemSegredos('/a?k=seg&key=s2&Authorization=Bearer%20x&ok=1')).toBe(
      '/a?k=[redigido]&key=[redigido]&Authorization=[redigido]&ok=1',
    );
  });
  it('não mexe em URL sem query ou sem segredo', () => {
    expect(urlSemSegredos('/healthz')).toBe('/healthz');
    expect(urlSemSegredos('/a?q=musica&page=2')).toBe('/a?q=musica&page=2');
    expect(urlSemSegredos(undefined)).toBeUndefined();
  });
  it('preserva o fragmento e nomes codificados', () => {
    expect(urlSemSegredos('/a?t%6Fken=zzz#f')).toBe('/a?t%6Fken=[redigido]#f');
  });
});
