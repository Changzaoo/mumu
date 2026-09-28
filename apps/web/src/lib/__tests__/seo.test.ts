import { describe, expect, it } from 'vitest';
import { aplicarSeo, seoDaRota } from '@/lib/seo';

describe('seoDaRota', () => {
  it('Home leva a marca com a promessa', () => {
    const seo = seoDaRota('/');
    expect(seo.titulo).toBeNull();
    expect(seo.indexar ?? true).toBe(true);
  });

  it('artista vira página própria, com o nome decodificado', () => {
    const seo = seoDaRota('/artista/GR6%20EXPLODE');
    expect(seo.titulo).toContain('GR6 EXPLODE');
    expect(seo.descricao).toContain('GR6 EXPLODE');
    expect(seo.caminho).toBe('/artista/GR6%20EXPLODE');
  });

  it('páginas pessoais não são indexadas', () => {
    for (const p of ['/library', '/liked', '/dispositivo', '/s/abc', '/settings']) {
      expect(seoDaRota(p).indexar, p).toBe(false);
    }
  });

  it('rota desconhecida (404) não é indexada', () => {
    expect(seoDaRota('/nada/disso').indexar).toBe(false);
  });

  it('não quebra com URL malformada', () => {
    expect(() => seoDaRota('/artista/%E0%A4%A')).not.toThrow();
  });
});

describe('aplicarSeo', () => {
  it('troca título, descrição, canonical e robots sem empilhar tags', () => {
    aplicarSeo(seoDaRota('/genero/Funk'));
    aplicarSeo(seoDaRota('/library'));
    expect(document.title).toBe('Sua biblioteca | radinho.online');
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toContain(
      'noindex',
    );
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(
      'https://radinho.online/library',
    );
  });
});
