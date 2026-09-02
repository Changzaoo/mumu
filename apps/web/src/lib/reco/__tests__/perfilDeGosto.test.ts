/**
 * O PERFIL DE GOSTO — o que ele tem que acertar para a Home não mentir.
 *
 * Cada teste aqui trava uma decisão que, se cair, produz um sintoma que a
 * pessoa consegue descrever: "só aparece o que eu não ouço", "escolhi rock no
 * começo e ele não larga", "curti uma música e o app virou aquilo".
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';
import { PLAYS_PARA_CONFIAR, perfilDeGosto, type PlayObservado } from '@/lib/reco/perfilDeGosto';

const AGORA = new Date('2026-09-02T12:00:00.000Z');

function faixa(id: string, genero: string, artista = `Artista ${id}`): TrackDto {
  return makeTrack(id, {
    genre: genero,
    artists: [{ id: `a:${artista}`, name: artista, slug: '', imageUrl: null }],
  });
}

function play(track: TrackDto, diasAtras: number, playedMs?: number): PlayObservado {
  return {
    track,
    playedAt: new Date(AGORA.getTime() - diasAtras * 86_400_000).toISOString(),
    playedMs,
  };
}

describe('perfil de gosto', () => {
  it('o gênero mais ouvido vira o topo', () => {
    const perfil = perfilDeGosto({
      historico: [
        play(faixa('g1', 'Gospel'), 1),
        play(faixa('g2', 'Gospel'), 2),
        play(faixa('g3', 'Gospel'), 3),
        play(faixa('r1', 'Rock'), 1),
      ],
      curtidas: [],
      now: AGORA,
    });

    expect(perfil.generoTopo).toBe('Gospel');
    expect(perfil.familiaTopo).toBe('devocional');
    expect(perfil.fatiaDoGenero('Gospel')).toBeGreaterThan(0.5);
  });

  it('o play de hoje pesa mais que o de dois meses atrás', () => {
    const recente = perfilDeGosto({
      historico: [play(faixa('a', 'Samba'), 0)],
      curtidas: [],
      now: AGORA,
    });
    const antigo = perfilDeGosto({
      historico: [play(faixa('a', 'Samba'), 60)],
      curtidas: [],
      now: AGORA,
    });

    expect(recente.afinidadeDoGenero('Samba')).toBeGreaterThan(
      antigo.afinidadeDoGenero('Samba') * 3,
    );
  });

  it('ouvir a faixa inteira pesa mais que ouvir os 30s da regra', () => {
    const longa = makeTrack('longa', { genre: 'Rock', durationMs: 480_000 });
    const inteira = perfilDeGosto({
      historico: [play(longa, 0, 480_000)],
      curtidas: [],
      now: AGORA,
    });
    const so30s = perfilDeGosto({
      historico: [play(longa, 0, 30_000)],
      curtidas: [],
      now: AGORA,
    });

    expect(inteira.afinidadeDoGenero('Rock')).toBeGreaterThan(so30s.afinidadeDoGenero('Rock'));
    // …mas os 30s não valem zero: a pessoa passou meio minuto ali de propósito.
    expect(so30s.afinidadeDoGenero('Rock')).toBeGreaterThan(0.3);
  });

  it('duração zerada (faixa importada sem sondagem) não vira "ela não gosta"', () => {
    const semDuracao = makeTrack('sem', { genre: 'Forró', durationMs: 0 });
    const perfil = perfilDeGosto({
      historico: [play(semDuracao, 0, 0)],
      curtidas: [],
      now: AGORA,
    });
    expect(perfil.afinidadeDoGenero('Forró')).toBeGreaterThan(0.9);
  });

  it('uma curtida solta não vence um hábito', () => {
    const perfil = perfilDeGosto({
      historico: Array.from({ length: 10 }, (_, i) => play(faixa(`p${i}`, 'Pagode'), i)),
      curtidas: [faixa('j1', 'Jazz')],
      now: AGORA,
    });
    expect(perfil.generoTopo).toBe('Pagode');
  });

  it('a família soma os gêneros vizinhos', () => {
    // Samba, Pagode e Axé são a mesma família; sozinho, nenhum ganha do Rock.
    const perfil = perfilDeGosto({
      historico: [
        play(faixa('s', 'Samba'), 0),
        play(faixa('p', 'Pagode'), 0),
        play(faixa('a', 'Axé'), 0),
        play(faixa('r1', 'Rock'), 0),
        play(faixa('r2', 'Rock'), 0),
      ],
      curtidas: [],
      now: AGORA,
    });
    expect(perfil.generoTopo).toBe('Rock');
    expect(perfil.familiaTopo).toBe('samba');
  });

  it('a escolha do onboarding manda no dia zero', () => {
    const perfil = perfilDeGosto({
      historico: [],
      curtidas: [],
      sementesDeGenero: ['Gospel'],
      now: AGORA,
    });
    expect(perfil.generoTopo).toBe('Gospel');
    // Declaração não é comportamento: a massa de sinal continua zerada, e é ela
    // que decide se o app já pode confiar no que mediu.
    expect(perfil.massaDeSinal).toBe(0);
    expect(perfil.plays).toBeLessThan(PLAYS_PARA_CONFIAR);
  });

  it('a escolha do onboarding é esquecida por quem ouve outra coisa', () => {
    const perfil = perfilDeGosto({
      // Um mês ouvindo samba depois de ter escolhido rock ao entrar.
      historico: Array.from({ length: 25 }, (_, i) => play(faixa(`s${i}`, 'Samba'), i % 20)),
      curtidas: [],
      sementesDeGenero: ['Rock'],
      now: AGORA,
    });
    expect(perfil.generoTopo).toBe('Samba');
    expect(perfil.afinidadeDoGenero('Samba')).toBeGreaterThan(perfil.afinidadeDoGenero('Rock') * 5);
  });

  it('só o artista principal é creditado — convidado de feat. não vira gosto', () => {
    const comFeat = makeTrack('feat', {
      genre: 'Trap',
      artists: [
        { id: 'a1', name: 'Dona da faixa', slug: '', imageUrl: null },
        { id: 'a2', name: 'Convidado', slug: '', imageUrl: null },
      ],
    });
    const perfil = perfilDeGosto({ historico: [play(comFeat, 0)], curtidas: [], now: AGORA });
    expect(perfil.porArtista.has('dona da faixa')).toBe(true);
    expect(perfil.porArtista.has('convidado')).toBe(false);
  });

  it('faixa sem gênero próprio herda o do agrupamento da biblioteca', () => {
    const semGenero = makeTrack('x', { genre: null });
    const perfil = perfilDeGosto({
      historico: [play(semGenero, 0)],
      curtidas: [],
      generoDaFaixa: new Map([['x', 'MPB']]),
      now: AGORA,
    });
    expect(perfil.generoTopo).toBe('MPB');
  });

  it('sem sinal nenhum não inventa um topo', () => {
    const perfil = perfilDeGosto({ historico: [], curtidas: [], now: AGORA });
    expect(perfil.generoTopo).toBeNull();
    expect(perfil.familiaTopo).toBeNull();
    expect(perfil.fatiaDoGenero('Gospel')).toBe(0);
  });
});
