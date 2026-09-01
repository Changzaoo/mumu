import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { faixasFavoritas, type PlayDaFaixa } from '@/lib/reco/faixasFavoritas';
import { makeTrack } from '@/test/factories';

const NOW = new Date('2026-09-01T20:00:00.000Z');

function play(track: TrackDto, diasAtras: number): PlayDaFaixa {
  return { track, playedAt: new Date(NOW.getTime() - diasAtras * 86_400_000).toISOString() };
}

describe('faixasFavoritas', () => {
  it('ordena por quantidade de plays', () => {
    const a = makeTrack('a');
    const b = makeTrack('b');
    const top = faixasFavoritas([play(a, 1), play(b, 1), play(b, 2)], [], { now: NOW });
    expect(top.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('play recente vale mais que play antigo', () => {
    const a = makeTrack('a');
    const b = makeTrack('b');
    const top = faixasFavoritas([play(a, 0), play(b, 120)], [], { now: NOW });
    expect(top.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('curtida empurra para cima o que já é tocado', () => {
    const a = makeTrack('a');
    const b = makeTrack('b');
    const top = faixasFavoritas([play(a, 1), play(b, 1), play(b, 1)], [a], { now: NOW });
    expect(top.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('curtida sem nenhum play não entra — senão a prateleira vira cópia de Curtidas', () => {
    const tocada = makeTrack('tocada');
    const soCurtida = makeTrack('so-curtida');
    const top = faixasFavoritas([play(tocada, 3)], [soCurtida], { now: NOW });
    expect(top.map((t) => t.id)).toEqual(['tocada']);
  });

  it('respeita o limite e devolve vazio sem histórico', () => {
    const tracks = ['a', 'b', 'c'].map((id) => makeTrack(id));
    expect(
      faixasFavoritas(
        tracks.map((t) => play(t, 1)),
        [],
        { now: NOW, limite: 2 },
      ),
    ).toHaveLength(2);
    expect(faixasFavoritas([], [makeTrack('x')], { now: NOW })).toEqual([]);
  });

  it('play com data ilegível conta, só não ganha bônus de recência', () => {
    const a = makeTrack('a');
    const b = makeTrack('b');
    const top = faixasFavoritas([{ track: a, playedAt: 'nada disso' }, play(b, 0)], [], {
      now: NOW,
    });
    expect(top.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
