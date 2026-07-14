import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import {
  buildRecommendations,
  type RecoEntry,
  type RecoInputs,
  type RecoPlay,
} from '@/lib/reco/recommend';
import { makeTrack } from '@/test/factories';

const NOW = new Date('2026-07-14T20:00:00.000Z');

function track(id: string, artist: string, genre: string | null = null): TrackDto {
  return {
    ...makeTrack(id, { title: `Faixa ${id}` }),
    genre: genre ?? undefined,
    artists: [{ id: `a:${artist}`, name: artist, slug: '', imageUrl: null }],
  } as TrackDto;
}

function entry(t: TrackDto, daysAgo = 30): RecoEntry {
  return { track: t, addedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() };
}

function play(t: TrackDto, daysAgo: number, hour?: number): RecoPlay {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  if (hour !== undefined) at.setHours(hour, 30, 0, 0);
  return { playedAt: at.toISOString(), track: t };
}

/** Biblioteca base: 2 artistas com 4 faixas cada, gêneros distintos. */
function baseLibrary(): { a: TrackDto[]; b: TrackDto[]; entries: RecoEntry[] } {
  const a = [1, 2, 3, 4].map((i) => track(`a${i}`, 'Artista A', 'Trap'));
  const b = [1, 2, 3, 4].map((i) => track(`b${i}`, 'Artista B', 'Rock'));
  return { a, b, entries: [...a, ...b].map((t) => entry(t)) };
}

function inputs(over: Partial<RecoInputs>): RecoInputs {
  return { entries: [], history: [], liked: [], now: NOW, ...over };
}

describe('buildRecommendations — motor local', () => {
  it('decaimento temporal: quem você ouviu ONTEM vence quem ouviu há 60 dias', () => {
    const { a, b, entries } = baseLibrary();
    const history = [
      ...a.flatMap((t) => [play(t, 1), play(t, 2)]), // A: 8 plays recentes
      ...b.flatMap((t) => [play(t, 60), play(t, 61)]), // B: 8 plays antigos
    ];
    const recos = buildRecommendations(inputs({ entries, history }));
    expect(recos[0]?.key).toBe('genre:Trap'); // cluster do Artista A na frente
  });

  it('curtida vale bônus: artista pouco ouvido mas curtido sobe no ranking', () => {
    const { a, b, entries } = baseLibrary();
    const history = [
      ...a.map((t) => play(t, 3)), // A: 4 plays
      ...b.map((t) => play(t, 3)), // B: 4 plays (empate técnico)
      ...a.slice(0, 2).map((t) => play(t, 4)), // desempata levemente p/ A
    ];
    // Sem curtidas, A vence; com 2 curtidas em B (bônus 3× cada), B vira o topo.
    const sem = buildRecommendations(inputs({ entries, history }));
    expect(sem[0]?.key).toBe('genre:Trap');
    const com = buildRecommendations(inputs({ entries, history, liked: [b[0]!, b[1]!] }));
    expect(com[0]?.key).toBe('genre:Rock');
  });

  it('"De volta aos seus ouvidos" traz o esquecido e exclui o recente', () => {
    const { a, b, entries } = baseLibrary();
    const history = [
      play(a[0]!, 30),
      play(a[0]!, 35), // ≥2 plays, sem play há 21+ dias → nostalgia
      ...b.flatMap((t) => [play(t, 1), play(t, 2)]), // recentes (enche o motor)
      ...a.slice(1).map((t) => play(t, 2)),
    ];
    const recos = buildRecommendations(inputs({ entries, history }));
    const back = recos.find((r) => r.key === 'reco:back');
    // a0 é elegível; pode não formar prateleira (mín. 4 candidatos) — mas se
    // formar, o recente b0 NUNCA pode estar lá.
    if (back) {
      expect(back.tracks.some((t) => t.id === 'a0')).toBe(true);
      expect(back.tracks.some((t) => t.id === 'b1')).toBe(false);
    }
    // Garantia direta da regra: com 4 faixas esquecidas, a prateleira existe.
    const forgotten = [1, 2, 3, 4].map((i) => track(`old${i}`, 'Artista A', 'Trap'));
    const recos2 = buildRecommendations(
      inputs({
        entries: [...entries, ...forgotten.map((t) => entry(t))],
        history: [...history, ...forgotten.flatMap((t) => [play(t, 40), play(t, 45)])],
      }),
    );
    const back2 = recos2.find((r) => r.key === 'reco:back');
    expect(back2).toBeDefined();
    expect(back2!.tracks.some((t) => t.id.startsWith('old'))).toBe(true);
    expect(back2!.tracks.some((t) => t.id.startsWith('b'))).toBe(false);
  });

  it('"Descobertas" só recomenda o que NUNCA tocou', () => {
    const { a, entries } = baseLibrary();
    const never = [1, 2, 3, 4].map((i) => track(`novo${i}`, 'Artista A', 'Trap'));
    const history = a.flatMap((t) => [play(t, 1), play(t, 2), play(t, 3)]);
    const recos = buildRecommendations(
      inputs({ entries: [...entries, ...never.map((t) => entry(t, 2))], history }),
    );
    const disc = recos.find((r) => r.key === 'reco:discover');
    expect(disc).toBeDefined();
    expect(disc!.tracks.every((t) => t.id.startsWith('novo') || t.id.startsWith('b'))).toBe(true);
    expect(disc!.tracks.some((t) => t.id.startsWith('novo'))).toBe(true);
  });

  it('"Para agora" aparece com sinal na janela da hora atual', () => {
    const { a, b, entries } = baseLibrary();
    const hourNow = NOW.getHours();
    const history = [
      // 8+ plays na janela ±2h da hora atual, em dias variados
      ...a.flatMap((t) => [play(t, 3, hourNow), play(t, 10, hourNow)]),
      // plays fora da janela
      ...b.map((t) => play(t, 3, (hourNow + 10) % 24)),
    ];
    const recos = buildRecommendations(inputs({ entries, history }));
    const agora = recos.find((r) => r.key === 'reco:now');
    expect(agora).toBeDefined();
    expect(agora!.tracks.every((t) => t.id.startsWith('a'))).toBe(true);
  });

  it('determinístico dentro do mesmo dia: duas chamadas, mesma ordem', () => {
    const { a, b, entries } = baseLibrary();
    const history = [...a, ...b].flatMap((t) => [play(t, 1), play(t, 5)]);
    const r1 = buildRecommendations(inputs({ entries, history }));
    const r2 = buildRecommendations(inputs({ entries, history }));
    expect(r1.map((r) => r.key)).toEqual(r2.map((r) => r.key));
    expect(r1.map((r) => r.tracks.map((t) => t.id))).toEqual(
      r2.map((r) => r.tracks.map((t) => t.id)),
    );
  });

  it('cold start (<10 plays): degrada para mixes simples por gênero/artista', () => {
    const { a, entries } = baseLibrary();
    const recos = buildRecommendations(inputs({ entries, history: [play(a[0]!, 1)] }));
    expect(recos.length).toBeGreaterThan(0);
    expect(recos.every((r) => r.key.startsWith('genre:') || r.key.startsWith('artist:'))).toBe(
      true,
    );
  });
});
