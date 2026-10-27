/**
 * A medida da recomendação: taxa de pulo por fonte, antes e depois da
 * coerência de gênero.
 */
import { describe, expect, it } from 'vitest';
import { ehRecomendacao, fonteDoContexto, relatorioDeRecomendacao, taxaDePulo } from '@/lib/reco/taxaDePulo';
import type { Pulo } from '@/lib/reco/pulos';

const DESDE = Date.parse('2026-10-27T21:00:00.000Z');
const antes = (h: number) => new Date(DESDE - h * 3600_000);
const depois = (h: number) => new Date(DESDE + h * 3600_000);

const play = (em: Date, source: string) => ({ playedAt: em.toISOString(), source });
const pulo = (em: Date, fonte?: string): Pulo => ({ id: 'x', artista: 'a', em: em.getTime(), fracao: 0.1, ...(fonte ? { fonte } : {}) });

describe('o que é recomendação', () => {
  it('Home, rádio e prateleiras do gosto são; álbum, playlist e artista não', () => {
    expect(ehRecomendacao('home:em-alta:Pop')).toBe(true);
    expect(ehRecomendacao('radio:')).toBe(true);
    expect(ehRecomendacao('library:genre:Trap')).toBe(true);
    expect(ehRecomendacao('library:ramo:artista:x')).toBe(true);
    expect(ehRecomendacao('library:reco-album:y')).toBe(true);
    expect(ehRecomendacao('library:album:y')).toBe(false);
    expect(ehRecomendacao('album:')).toBe(false);
    expect(ehRecomendacao('playlist:p1')).toBe(false);
    expect(ehRecomendacao(undefined)).toBe(false);
  });

  it('a fonte do contexto é "source:sourceId"', () => {
    expect(fonteDoContexto({ source: 'home', sourceId: 'em-alta:Pop' })).toBe('home:em-alta:Pop');
    expect(fonteDoContexto({ source: 'radio' })).toBe('radio:');
    expect(fonteDoContexto(null)).toBeUndefined();
  });
});

describe('taxaDePulo', () => {
  it('separa antes/depois e recomendação/escolha própria', () => {
    const historico = [
      play(antes(5), 'home'),
      play(antes(4), 'home'),
      play(antes(3), 'album'),
      play(depois(1), 'home'),
      play(depois(2), 'home'),
      play(depois(3), 'home'),
      play(depois(4), 'playlist'),
    ];
    const pulos = [
      pulo(antes(2), 'home:genre:Trap'),
      pulo(antes(2), 'home:genre:Trap'),
      pulo(antes(1), 'album:'),
      pulo(depois(1), 'home:em-alta:Pop'),
      pulo(depois(2)), // sem fonte: fica fora
    ];
    const t = taxaDePulo(historico, pulos, DESDE);
    expect(t.antes).toEqual({ plays: 2, pulos: 2, taxa: 0.5 });
    expect(t.depois).toEqual({ plays: 3, pulos: 1, taxa: 0.25 });
    expect(t.outrasAntes).toEqual({ plays: 1, pulos: 1, taxa: 0.5 });
    expect(t.outrasDepois).toEqual({ plays: 1, pulos: 0, taxa: 0 });
  });

  it('sem amostra, a taxa é nula e o relatório diz isso', () => {
    const t = taxaDePulo([], [], DESDE);
    expect(t.antes.taxa).toBeNull();
    expect(relatorioDeRecomendacao([], [], DESDE)).toContain('sem amostra');
  });

  it('o relatório traz os dois lados em porcentagem', () => {
    const r = relatorioDeRecomendacao([play(antes(1), 'home'), play(depois(1), 'home')], [pulo(antes(1), 'home:')], DESDE);
    expect(r).toContain('recomendações 50% (1 pulos em 2)');
    expect(r).toContain('recomendações 0% (0 pulos em 1)');
  });
});
