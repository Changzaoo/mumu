/**
 * Agente pesquisador: quem ele decide investigar.
 *
 * Um agente que baixa sozinho gasta internet e disco de alguém sem pedir
 * licença, então a escolha do alvo é a parte que precisa estar certa. Boa
 * parte destes testes cobre quem ele NÃO pode escolher.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/local/importerHelper', () => ({ aiSearchYouTube: vi.fn() }));
vi.mock('@/lib/local/importQueue', () => ({ enqueue: vi.fn() }));
vi.mock('@/lib/local/localLibrary', () => ({ list: vi.fn(() => []), findBySource: vi.fn() }));
vi.mock('@/lib/local/localHistory', () => ({ list: vi.fn(() => []) }));
vi.mock('@/lib/local/localLikes', () => ({ list: vi.fn(() => []) }));

import { escolherArtistas } from '@/lib/local/pesquisador';

const AGORA = new Date('2026-08-03T12:00:00Z');

function faixa(artista: string, id = artista): TrackDto {
  return {
    id,
    title: `Música de ${artista}`,
    artists: [{ id: `a:${artista}`, name: artista, slug: artista, imageUrl: null }],
    album: null,
    coverUrl: null,
    durationMs: 180_000,
  } as TrackDto;
}

/** N plays recentes do artista. */
function plays(artista: string, n: number): { track: TrackDto; playedAt: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    track: faixa(artista, `${artista}:${i}`),
    playedAt: '2026-08-01T10:00:00Z',
  }));
}

describe('escolherArtistas', () => {
  it('escolhe quem é muito ouvido e pouco representado', () => {
    const alvos = escolherArtistas(plays('Matuê', 8), [{ track: faixa('Matuê') }], [], AGORA);
    expect(alvos.map((a) => a.nome)).toEqual(['Matuê']);
    expect(alvos[0]!.plays).toBe(8);
    expect(alvos[0]!.naBiblioteca).toBe(1);
  });

  it('ignora quem já tem biblioteca cheia — não há o que acrescentar', () => {
    const biblioteca = Array.from({ length: 12 }, (_, i) => ({ track: faixa('Matuê', `m${i}`) }));
    expect(escolherArtistas(plays('Matuê', 20), biblioteca, [], AGORA)).toEqual([]);
  });

  it('ignora sinal fraco — dois plays podem ter sido a fila andando sozinha', () => {
    expect(escolherArtistas(plays('Aleatório', 2), [], [], AGORA)).toEqual([]);
  });

  it('curtida pesa mais que play: é a pessoa dizendo, não a fila andando', () => {
    const curtido = faixa('Curtido');
    // 1 play + 1 curtida = 4 pontos; 3 plays = 3 pontos.
    const alvos = escolherArtistas(
      [...plays('Curtido', 1), ...plays('SoTocou', 3)],
      [],
      [curtido],
      AGORA,
    );
    expect(alvos[0]!.nome).toBe('Curtido');
  });

  it('ignora play velho — gosto de dois meses atrás não é o de agora', () => {
    const velhos = Array.from({ length: 10 }, () => ({
      track: faixa('Antigo'),
      playedAt: '2026-05-01T10:00:00Z',
    }));
    expect(escolherArtistas(velhos, [], [], AGORA)).toEqual([]);
  });

  it('limita quantos artistas investiga por rodada', () => {
    const history = [...plays('A', 20), ...plays('B', 18), ...plays('C', 16), ...plays('D', 14)];
    expect(escolherArtistas(history, [], [], AGORA)).toHaveLength(2);
  });

  it('trata o mesmo artista escrito de dois jeitos como um só', () => {
    const history = [...plays('Matuê', 3), ...plays('MATUE', 3)];
    const alvos = escolherArtistas(history, [], [], AGORA);
    expect(alvos).toHaveLength(1);
    expect(alvos[0]!.plays).toBe(6);
  });

  it('histórico vazio não inventa alvo', () => {
    expect(escolherArtistas([], [], [], AGORA)).toEqual([]);
  });
});
