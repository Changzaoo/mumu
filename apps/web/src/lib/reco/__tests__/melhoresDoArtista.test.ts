import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { melhoresDoArtista } from '@/lib/reco/melhoresDoArtista';
import type { PlayObservado } from '@/lib/reco/perfilDeGosto';
import { makeTrack } from '@/test/factories';

const NOW = new Date('2026-09-01T20:00:00.000Z');

const faixa = (id: string, title: string, extra: Partial<TrackDto> = {}): TrackDto =>
  makeTrack(id, { title, ...extra });

function play(track: TrackDto, diasAtras = 1): PlayObservado {
  return { track, playedAt: new Date(NOW.getTime() - diasAtras * 86_400_000).toISOString() };
}

const ids = (list: TrackDto[]): string[] => list.map((t) => t.id);

describe('melhoresDoArtista', () => {
  it('sem sinal nenhum, devolve o acervo na ordem em que está', () => {
    const acervo = [faixa('a', 'A'), faixa('b', 'B'), faixa('c', 'C')];
    expect(ids(melhoresDoArtista(acervo, { now: NOW }))).toEqual(['a', 'b', 'c']);
  });

  it('os hits do ranking mundial vêm primeiro, na ordem do ranking', () => {
    const acervo = [faixa('lado-b', 'Lado B'), faixa('hit2', 'Hit Dois'), faixa('hit1', 'Hit Um')];
    const top = melhoresDoArtista(acervo, { rankingMundial: ['Hit Um', 'Hit Dois'], now: NOW });
    expect(ids(top)).toEqual(['hit1', 'hit2', 'lado-b']);
  });

  it('fora do ranking, o que a pessoa mais toca vem antes', () => {
    const a = faixa('a', 'A');
    const b = faixa('b', 'B');
    const hit = faixa('hit', 'Hit');
    const top = melhoresDoArtista([a, b, hit], {
      rankingMundial: ['Hit'],
      historico: [play(b), play(b, 2), play(a)],
      now: NOW,
    });
    expect(ids(top)).toEqual(['hit', 'b', 'a']);
  });

  it('sem ranking, plays e curtida ordenam a seleção', () => {
    const a = faixa('a', 'A');
    const b = faixa('b', 'B');
    const c = faixa('c', 'C');
    const top = melhoresDoArtista([a, b, c], {
      historico: [play(a)],
      curtidas: [c],
      now: NOW,
    });
    // Curtida (peso 3) vale mais que um play; quem não tem sinal fica no fim.
    expect(ids(top)).toEqual(['c', 'a', 'b']);
  });

  it('a mesma música duas vezes no acervo toca uma vez só', () => {
    const single = faixa('single', 'Evidências');
    const aoVivo = faixa('ao-vivo', 'Evidências (feat. Fulano)');
    const outra = faixa('outra', 'Outra');
    const top = melhoresDoArtista([outra, aoVivo, single], {
      rankingMundial: ['Evidências'],
      historico: [play(single)],
      now: NOW,
    });
    expect(ids(top)).toEqual(['single', 'outra']);
  });

  it('prévia de 30s não entra na fila', () => {
    const top = melhoresDoArtista(
      [faixa('previa', 'Prévia', { previewOnly: true }), faixa('real', 'Real')],
      { now: NOW },
    );
    expect(ids(top)).toEqual(['real']);
  });

  it('respeita o limite', () => {
    const acervo = Array.from({ length: 80 }, (_, i) => faixa(`f${i}`, `Faixa ${i}`));
    expect(melhoresDoArtista(acervo, { now: NOW })).toHaveLength(50);
    expect(melhoresDoArtista(acervo, { now: NOW, limite: 5 })).toHaveLength(5);
  });
});
