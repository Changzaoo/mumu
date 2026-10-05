/**
 * RODADA DE GOSTO: o que a prateleira "Feito para você" promete em situações de borda.
 * Tudo sobre a função PURA `buildRecommendations(inputs)` — nada de storage aqui.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import {
  buildRecommendations,
  mixDaChave,
  type RecoEntry,
  type RecoInputs,
  type RecoPlay,
} from '@/lib/reco/recommend';
import { makeTrack } from '@/test/factories';

const NOW = new Date('2026-07-14T20:00:00.000Z');

function track(id: string, artist: string, genre: string | null = null): TrackDto {
  return {
    ...makeTrack(id, { title: `Faixa ${id}`, coverUrl: `https://c/${id}.jpg` }),
    genre: genre ?? undefined,
    artists: [{ id: `a:${artist}`, name: artist, slug: '', imageUrl: null }],
  } as TrackDto;
}
const entry = (t: TrackDto, daysAgo = 30): RecoEntry => ({
  track: t,
  addedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});
const play = (t: TrackDto, daysAgo: number): RecoPlay => ({
  playedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  track: t,
});
const inputs = (over: Partial<RecoInputs>): RecoInputs => ({
  entries: [],
  history: [],
  liked: [],
  now: NOW,
  ...over,
});

describe('prateleira nunca vazia nem quebrada', () => {
  it('usuário novo, biblioteca vazia: lista vazia, sem exceção', () => {
    expect(buildRecommendations(inputs({}))).toEqual([]);
  });

  it('biblioteca de 1 faixa e nenhum histórico: ainda assim há um mix', () => {
    const t = track('u1', 'Solo');
    const recos = buildRecommendations(inputs({ entries: [entry(t)] }));
    expect(recos).toHaveLength(1);
    expect(recos[0]!.tracks.map((x) => x.id)).toEqual(['u1']);
  });

  it('histórico de 1 faixa só não derruba nem esvazia', () => {
    const lib = [1, 2, 3].map((i) => track(`g${i}`, `Art ${i}`, 'Pop'));
    const recos = buildRecommendations(
      inputs({ entries: lib.map((t) => entry(t)), history: [play(lib[0]!, 1)] }),
    );
    expect(recos.length).toBeGreaterThan(0);
  });

  it('só plays de faixas que saíram da biblioteca: cai no fallback, não fica vazio', () => {
    const lib = [1, 2, 3, 4].map((i) => track(`l${i}`, 'Dono', 'Rock'));
    const fantasmas = Array.from({ length: 12 }, (_, i) => track(`fantasma${i}`, 'Sumido', 'Jazz'));
    const recos = buildRecommendations(
      inputs({
        entries: lib.map((t) => entry(t)),
        history: fantasmas.map((t) => play(t, 1)),
      }),
    );
    expect(recos.length).toBeGreaterThan(0);
    const ids = new Set(lib.map((t) => t.id));
    expect(recos.every((r) => r.tracks.every((t) => ids.has(t.id)))).toBe(true);
  });

  it('dados corrompidos (null no histórico/curtidas, faixa sem artists) não derrubam a home', () => {
    const lib = [1, 2, 3, 4].map((i) => track(`c${i}`, 'Art', 'Rock'));
    const semArtists = { ...makeTrack('semart'), artists: undefined } as unknown as TrackDto;
    const sujo = [null, undefined, {}, { playedAt: 'ontem', track: lib[0] }, play(semArtists, 1)];
    const history = [
      ...(sujo as unknown as RecoPlay[]),
      ...lib.flatMap((t) => [play(t, 1), play(t, 2), play(t, 3)]),
    ];
    expect(() =>
      buildRecommendations(
        inputs({
          entries: [...lib.map((t) => entry(t)), { track: semArtists, addedAt: 'x' }],
          history,
          liked: [null, semArtists, lib[0]!] as unknown as TrackDto[],
        }),
      ),
    ).not.toThrow();
  });
});

describe('sinais de gosto', () => {
  it('SÓ CURTIDAS (sem histórico): o gênero curtido vem primeiro, não o maior', () => {
    const trap = [1, 2, 3, 4, 5].map((i) => track(`t${i}`, `Trapper ${i}`, 'Trap'));
    const rock = [1, 2, 3, 4].map((i) => track(`r${i}`, `Rocker ${i}`, 'Rock'));
    const recos = buildRecommendations(
      inputs({
        entries: [...trap, ...rock].map((t) => entry(t)),
        liked: [rock[0]!, rock[1]!, rock[2]!],
      }),
    );
    expect(recos[0]!.key).toBe('genre:Rock');
  });

  it('histórico enorme respeita os tetos e não repete faixa dentro do mix', () => {
    const lib = Array.from({ length: 60 }, (_, i) =>
      track(`h${i}`, `Art ${i % 15}`, i % 2 ? 'Rock' : 'Pop'),
    );
    const history = Array.from({ length: 5000 }, (_, i) => play(lib[i % lib.length]!, i % 60));
    const recos = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    expect(recos.length).toBeGreaterThan(0);
    expect(recos.length).toBeLessThanOrEqual(10);
    for (const r of recos) {
      expect(r.tracks.length).toBeLessThanOrEqual(30);
      expect(new Set(r.tracks.map((t) => t.id)).size).toBe(r.tracks.length);
    }
  });

  it('diversidade: nenhum mix de cluster traz mais de 5 faixas do mesmo artista', () => {
    const dono = Array.from({ length: 20 }, (_, i) => track(`d${i}`, 'Dominante', 'Rock'));
    const outro = [1, 2, 3].map((i) => track(`o${i}`, 'Outro', 'Rock'));
    const lib = [...dono, ...outro];
    const history = lib.flatMap((t) => [play(t, 1), play(t, 2)]);
    const recos = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    const mix = recos.find((r) => r.key === 'genre:Rock')!;
    const porArtista = mix.tracks.filter((t) => t.artists[0]!.name === 'Dominante').length;
    expect(porArtista).toBeLessThanOrEqual(5);
  });

  it('gênero com caixa/espaço variante vira UM mix só', () => {
    const lib = [
      track('v1', 'A', 'Rock'),
      track('v2', 'B', 'rock'),
      track('v3', 'C', ' ROCK '),
      track('v4', 'D', 'Rock'),
    ];
    const recos = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)) }));
    expect(recos.filter((r) => r.key.startsWith('genre:'))).toHaveLength(1);
  });

  it('artistas sem gênero (IA ausente) ainda geram mix por artista, com histórico', () => {
    const lib = Array.from({ length: 12 }, (_, i) => track(`n${i}`, `Sem Genero ${i % 3}`));
    const history = lib.flatMap((t) => [play(t, 1), play(t, 3)]);
    const recos = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    expect(recos.some((r) => r.key.startsWith('artist:'))).toBe(true);
    expect(recos.every((r) => !r.key.startsWith('genre:'))).toBe(true);
  });
});

describe('o mix aberto é o mix mostrado', () => {
  it('mixDaChave devolve o conteúdo do CARD, não o gênero inteiro', () => {
    const lib = [
      ...Array.from({ length: 12 }, (_, i) => track(`a${i}`, `Artista ${i % 4}`, 'Trap')),
      ...Array.from({ length: 4 }, (_, i) => track(`z${i}`, 'Quieto', 'Trap')),
    ];
    const history = lib.slice(0, 12).flatMap((t) => [play(t, 1), play(t, 2)]);
    const recos = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    const card = recos.find((r) => r.key === 'genre:Trap')!;
    expect(mixDaChave(recos, 'genre:Trap')).toBe(card);
    expect(mixDaChave(recos, 'genre:Inexistente')).toBeNull();
    expect(mixDaChave(recos, 'artist:Quieto')).toBeNull();
  });

  it('determinismo: mesmas entradas, mesmo mix (semente do dia)', () => {
    const lib = Array.from({ length: 16 }, (_, i) => track(`s${i}`, `Art ${i % 5}`, 'Pop'));
    const history = lib.flatMap((t) => [play(t, 1), play(t, 4)]);
    const a = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    const b = buildRecommendations(inputs({ entries: lib.map((t) => entry(t)), history }));
    expect(a.map((r) => r.tracks.map((t) => t.id))).toEqual(
      b.map((r) => r.tracks.map((t) => t.id)),
    );
  });
});
