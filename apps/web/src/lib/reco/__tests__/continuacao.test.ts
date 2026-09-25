import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';
import { escolherProximaPlaylist, reordenarPeloGosto } from '@/lib/reco/continuacao';

const f = (id: string, artista: string, genre = 'Trap'): TrackDto =>
  makeTrack(id, { genre, artists: [{ id: artista, name: artista, slug: '', imageUrl: null }] });

const lista = (id: string, faixas: TrackDto[]) => ({ id, title: id, faixas });

describe('escolherProximaPlaylist', () => {
  const atual = lista('trap-br', [f('1', 'Matuê'), f('2', 'Teto'), f('3', 'Wiu')]);

  it('emenda a mais parecida pelos artistas em comum', () => {
    const escolhida = escolherProximaPlaylist(atual, [
      lista('louvor', [f('4', 'Aline Barros', 'Gospel'), f('5', 'Fernandinho', 'Gospel')]),
      lista('trap-2', [f('6', 'Matuê'), f('7', 'Teto'), f('8', 'Orochi')]),
      lista('mistura', [f('9', 'Matuê'), f('10', 'Anitta', 'Funk')]),
    ]);
    expect(escolhida?.id).toBe('trap-2');
  });

  it('nada em comum não é continuação: devolve null e a rádio assume', () => {
    const escolhida = escolherProximaPlaylist(atual, [
      lista('louvor', [f('4', 'Aline Barros', 'Gospel'), f('5', 'Fernandinho', 'Gospel')]),
    ]);
    expect(escolhida).toBeNull();
  });

  it('não volta para a que acabou nem para as já emendadas (sem pingue-pongue)', () => {
    const candidatas = [atual, lista('trap-2', [f('6', 'Matuê'), f('7', 'Teto')])];
    expect(escolherProximaPlaylist(atual, candidatas, new Set(['trap-2']))).toBeNull();
  });

  it('playlist de uma faixa só não serve para emendar', () => {
    expect(escolherProximaPlaylist(atual, [lista('solo', [f('6', 'Matuê')])])).toBeNull();
  });
});

describe('reordenarPeloGosto', () => {
  const fila = [f('a', 'X'), f('b', 'Y'), f('c', 'Z'), f('d', 'W')];

  it('sem sinal nenhum, a ordem que veio fica', () => {
    const out = reordenarPeloGosto(fila, { fatorDePulo: () => 1 });
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('o que foi pulado há pouco desce — mas continua na fila', () => {
    const out = reordenarPeloGosto(fila, { fatorDePulo: (t) => (t.id === 'a' ? 0.3 : 1) });
    expect(out[0]?.id).not.toBe('a');
    expect(out.map((t) => t.id)).toContain('a');
  });

  it('o artista que a pessoa mais ouve sobe', () => {
    const out = reordenarPeloGosto(fila, {
      fatorDePulo: () => 1,
      afinidade: (t) => (t.id === 'c' ? 1 : 0),
    });
    expect(out.indexOf(fila[2] as TrackDto)).toBeLessThan(2);
  });
});
