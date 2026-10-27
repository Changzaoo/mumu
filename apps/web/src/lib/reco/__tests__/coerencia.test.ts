/**
 * O filtro duro antes das prateleiras: a biblioteca que chega ao motor já é a
 * que esta pessoa pode receber — pelo gosto E pela idade.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { bibliotecaCoerente, familiasDoPerfil } from '@/lib/reco/coerencia';
import { perfilDeGosto } from '@/lib/reco/perfilDeGosto';
import { makeTrack } from '@/test/factories';

const faixa = (id: string, genre: string | null, artista = 'A') =>
  makeTrack(id, { genre, artists: [{ id: 'a', name: artista, slug: '', imageUrl: null }] });

const entrada = (track: TrackDto, conteudoVeredicto?: 'limpo' | 'explicito') => ({
  track,
  ...(conteudoVeredicto ? { conteudoVeredicto } : {}),
});

const BIBLIOTECA = [
  entrada(faixa('g1', 'Gospel'), 'limpo'),
  entrada(faixa('g2', 'Gospel')),
  entrada(faixa('t1', 'Trap'), 'explicito'),
  entrada(faixa('t2', 'Trap'), 'limpo'),
  entrada(faixa('s1', 'Sertanejo'), 'limpo'),
  entrada(faixa('p1', 'Pagode'), 'limpo'),
  entrada(faixa('x1', null), 'limpo'),
];

const agora = new Date('2026-10-27T12:00:00Z');
const plays = (ids: string[]) =>
  ids.map((id) => ({
    track: BIBLIOTECA.find((e) => e.track.id === id)!.track,
    playedAt: agora.toISOString(),
    playedMs: 200_000,
  }));

const semIdade = () => true;

describe('familiasDoPerfil', () => {
  it('vira a afinidade por família em fatias que somam 1, da maior para a menor', () => {
    const perfil = perfilDeGosto({ historico: plays(['g1', 'g1', 'g2', 't1']), curtidas: [], now: agora });
    const familias = familiasDoPerfil(perfil);
    expect(familias.map((f) => f.familia)).toEqual(['devocional', 'urbano']);
    expect(familias.reduce((a, f) => a + f.fatia, 0)).toBeCloseTo(1, 5);
    expect(familias[0]!.fatia).toBeCloseTo(0.75, 5);
  });

  it('sem histórico nem semente, não há família', () => {
    expect(familiasDoPerfil(perfilDeGosto({ historico: [], curtidas: [], now: agora }))).toEqual([]);
  });
});

describe('bibliotecaCoerente', () => {
  it('quem só ouve gospel recebe só o gospel comprovadamente limpo', () => {
    const perfil = perfilDeGosto({ historico: plays(['g1', 'g1', 'g1']), curtidas: [], now: agora });
    const ids = bibliotecaCoerente(BIBLIOTECA, familiasDoPerfil(perfil), semIdade).map((e) => e.track.id);
    expect(ids).toEqual(['g1']);
  });

  it('quem só ouve trap não recebe gospel, mas recebe trap e o sem gênero', () => {
    const perfil = perfilDeGosto({ historico: plays(['t1', 't2', 't1']), curtidas: [], now: agora });
    const ids = bibliotecaCoerente(BIBLIOTECA, familiasDoPerfil(perfil), semIdade).map((e) => e.track.id);
    expect(ids).toEqual(['t1', 't2', 'x1']);
  });

  it('quem só ouve sertanejo recebe pagode e não recebe trap', () => {
    const perfil = perfilDeGosto({ historico: plays(['s1', 's1']), curtidas: [], now: agora });
    const ids = bibliotecaCoerente(BIBLIOTECA, familiasDoPerfil(perfil), semIdade).map((e) => e.track.id);
    expect(ids).toEqual(['s1', 'p1', 'x1']);
  });

  it('a semente do onboarding já fecha a fronteira no dia zero', () => {
    const perfil = perfilDeGosto({ historico: [], curtidas: [], sementesDeGenero: ['Gospel'], now: agora });
    const ids = bibliotecaCoerente(BIBLIOTECA, familiasDoPerfil(perfil), semIdade).map((e) => e.track.id);
    expect(ids).toEqual(['g1']);
  });

  it('sem gosto, só a idade filtra', () => {
    const soLimpos = (t: TrackDto) => t.id !== 't1';
    const ids = bibliotecaCoerente(BIBLIOTECA, [], soLimpos).map((e) => e.track.id);
    expect(ids).toEqual(['g1', 'g2', 't2', 's1', 'p1', 'x1']);
  });

  it('pular trap várias vezes tira o trap do topo — e com ele a oferta de trap', () => {
    const generoDaFaixa = new Map(BIBLIOTECA.map((e) => [e.track.id, e.track.genre ?? '']));
    const historico = plays(['t1', 's1', 's1']);
    const sem = perfilDeGosto({ historico, curtidas: [], generoDaFaixa, now: agora });
    expect(familiasDoPerfil(sem)[0]!.familia).toBe('sertanejo');
    const pulos = Array.from({ length: 6 }, () => ({ id: 't2', artista: 'a', em: agora.getTime() - 1000, fracao: 0.1 }));
    const com = perfilDeGosto({ historico, curtidas: [], generoDaFaixa, pulos, now: agora });
    expect(com.afinidadeDoGenero('Trap')).toBeLessThan(sem.afinidadeDoGenero('Trap'));
    expect(com.afinidadeDoGenero('Trap')).toBeGreaterThanOrEqual(0);
  });

  it('seguir um artista credita o artista e o gênero dele', () => {
    const generoDoArtista = new Map([['preto no branco', 'Gospel']]);
    const perfil = perfilDeGosto({ historico: [], curtidas: [], generoDoArtista, seguidos: ['Preto no Branco'], now: agora });
    expect(perfil.afinidadeDoGenero('Gospel')).toBeGreaterThan(0);
    expect(perfil.porArtista.get('preto no branco')).toBeGreaterThan(0);
    expect(familiasDoPerfil(perfil)[0]!.familia).toBe('devocional');
  });
});
