import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import { normTitle, rankTracks } from '@/lib/artistTop';

const track = (title: string): TrackDto => ({ id: `local:${title}`, title }) as unknown as TrackDto;

const titles = (list: TrackDto[]): string[] => list.map((t) => t.title);

describe('normTitle', () => {
  it('derruba acento, participação e sufixo editorial', () => {
    expect(normTitle('Coração (feat. Alguém)')).toBe('coracao');
    expect(normTitle('Song - 2011 Remastered')).toBe('song');
    expect(normTitle('Song [Deluxe]')).toBe('song');
  });
});

describe('rankTracks', () => {
  it('ordena pelo ranking do catálogo', () => {
    const local = [track('C'), track('A'), track('B')];
    expect(titles(rankTracks(local, ['A', 'B', 'C']))).toEqual(['A', 'B', 'C']);
  });

  it('mantém as não ranqueadas no fim, na ordem original', () => {
    const local = [track('Z'), track('B'), track('Y'), track('A')];
    expect(titles(rankTracks(local, ['A', 'B']))).toEqual(['A', 'B', 'Z', 'Y']);
  });

  it('casa mesmo com participação/remaster no título local', () => {
    const local = [track('Outra'), track('Evidências (feat. Fulano)')];
    expect(titles(rankTracks(local, ['Evidências']))[0]).toBe('Evidências (feat. Fulano)');
  });

  it('sem ranking, devolve a ordem local intacta', () => {
    const local = [track('C'), track('A')];
    expect(titles(rankTracks(local, []))).toEqual(['C', 'A']);
  });

  it('não perde nem duplica faixas', () => {
    const local = [track('A'), track('B'), track('C')];
    expect(rankTracks(local, ['C']).length).toBe(3);
  });
});
