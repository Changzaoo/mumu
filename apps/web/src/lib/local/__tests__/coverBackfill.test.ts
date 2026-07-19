import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import { appleArtwork } from '@/lib/catalog/itunes';
import {
  COVER_SWEEP_LIMIT,
  MAX_COVER_ATTEMPTS,
  countPendingCovers,
  isMissingCover,
  isMissingCredits,
  pickArtworkMatch,
  pickBackfillCandidates,
  scoreArtworkMatch,
} from '@/lib/local/coverBackfill';

function track(over: Partial<TrackDto> & { id: string }): TrackDto {
  return {
    durationMs: 1000,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [],
    streamUrl: null,
    downloadUrl: null,
    uploadedByUserId: null,
    title: 'Infiel',
    ...over,
  } as TrackDto;
}

describe('appleArtwork', () => {
  const raw = 'https://is1-ssl.mzstatic.com/image/thumb/Music/a/b/source/100x100bb.jpg';

  it('upgrades the 100×100 stamp to the grid size', () => {
    expect(appleArtwork(raw, 'grid')).toContain('600x600bb');
  });

  it('serves a full-screen size too', () => {
    expect(appleArtwork(raw, 'full')).toContain('1000x1000bb');
  });

  it('rewrites an ALREADY rewritten URL (idempotent + reversible)', () => {
    const grid = appleArtwork(raw, 'grid');
    expect(appleArtwork(grid, 'full')).toContain('1000x1000bb');
    expect(appleArtwork(appleArtwork(grid, 'full'), 'grid')).toBe(grid);
  });

  it('leaves a non-Apple URL and an empty string alone', () => {
    expect(appleArtwork('https://cdn.deezer.com/cover.jpg')).toBe(
      'https://cdn.deezer.com/cover.jpg',
    );
    expect(appleArtwork('')).toBe('');
  });
});

describe('scoreArtworkMatch', () => {
  const row = (title: string, artist: string) => ({
    title,
    artist,
    artworkUrl: 'https://x/100x100bb.jpg',
  });

  it('scores an exact title + artist highest', () => {
    expect(scoreArtworkMatch(row('Infiel', 'Marília Mendonça'), 'Infiel', 'Marilia Mendonca')).toBe(
      6,
    );
  });

  it('ignores accents and punctuation', () => {
    expect(
      scoreArtworkMatch(
        row('Evidências', 'Chitãozinho & Xororó'),
        'evidencias',
        'Chitaozinho e Xororo',
      ),
    ).toBeGreaterThan(0);
  });

  it('REFUSES a title match by another artist (wrong cover is worse than none)', () => {
    expect(scoreArtworkMatch(row('Infiel', 'Some Cover Band'), 'Infiel', 'Marília Mendonça')).toBe(
      0,
    );
  });

  it('without a known artist, accepts only an exact title', () => {
    expect(scoreArtworkMatch(row('Infiel', 'Whoever'), 'Infiel')).toBe(3);
    expect(scoreArtworkMatch(row('Infiel (Ao Vivo)', 'Whoever'), 'Infiel')).toBe(0);
  });

  it('rejects a row with no artwork', () => {
    expect(
      scoreArtworkMatch({ title: 'Infiel', artist: 'Marília Mendonça', artworkUrl: '' }, 'Infiel'),
    ).toBe(0);
  });

  it('picks the best row out of a list', () => {
    const rows = [row('Infiel', 'Tribute Band'), row('Infiel', 'Marília Mendonça')];
    expect(pickArtworkMatch(rows, 'Infiel', 'Marília Mendonça')?.artist).toBe('Marília Mendonça');
    expect(pickArtworkMatch([row('Outra Coisa', 'X')], 'Infiel', 'Marília Mendonça')).toBeNull();
  });
});

describe('candidate selection', () => {
  it('treats null and dead blob: URLs as missing', () => {
    expect(isMissingCover(track({ id: 'a' }))).toBe(true);
    expect(isMissingCover(track({ id: 'a', coverUrl: 'blob:http://x/1' }))).toBe(true);
    expect(isMissingCover(track({ id: 'a', coverUrl: 'https://x/c.jpg' }))).toBe(false);
  });

  it('flags tracks missing label or composer', () => {
    expect(isMissingCredits(track({ id: 'a' }))).toBe(true);
    expect(isMissingCredits(track({ id: 'a', label: 'Som Livre', composer: 'X' }))).toBe(false);
  });

  it('selects only coverless tracks with a usable title', () => {
    const list = [
      track({ id: 'a' }),
      track({ id: 'b', coverUrl: 'https://x/c.jpg' }),
      track({ id: 'c', title: 'faixa' }),
      track({ id: 'd', title: '   ' }),
      track({ id: 'e' }),
    ];
    expect(pickBackfillCandidates(list, {}).map((t) => t.id)).toEqual(['a', 'e']);
  });

  it('drops a track that already burned its attempts, and honours the cap', () => {
    const list = [track({ id: 'a' }), track({ id: 'b' })];
    expect(pickBackfillCandidates(list, { a: MAX_COVER_ATTEMPTS }).map((t) => t.id)).toEqual(['b']);
    expect(pickBackfillCandidates(list, { a: MAX_COVER_ATTEMPTS - 1 }).map((t) => t.id)).toEqual([
      'a',
      'b',
    ]);
    expect(pickBackfillCandidates(list, {}, 1)).toHaveLength(1);
  });

  it('caps a big library at COVER_SWEEP_LIMIT per session', () => {
    const many = Array.from({ length: 100 }, (_, i) => track({ id: `t${i}` }));
    expect(pickBackfillCandidates(many, {})).toHaveLength(COVER_SWEEP_LIMIT);
    // A contagem exibida ignora o teto por sessão — mostra a pendência real.
    expect(countPendingCovers(many, {})).toBe(100);
  });
});
