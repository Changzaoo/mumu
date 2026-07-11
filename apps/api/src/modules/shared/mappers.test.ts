import { describe, expect, it } from 'vitest';
import {
  applyLikedFlags,
  toAlbumDto,
  toTrackDto,
  toUploadDto,
  type AlbumRow,
  type TrackRow,
} from './mappers.js';

function fakeTrackRow(overrides: Partial<Record<string, unknown>> = {}): TrackRow {
  return {
    id: 'trk1',
    title: 'Falling Blue Lights',
    durationMs: 201_000,
    trackNumber: 3,
    discNumber: 1,
    explicit: false,
    playsCount: 42,
    coverUrl: null,
    dominantColor: '#112233',
    loudnessLufs: -11.4,
    truePeakDb: -0.8,
    waveform: null,
    hlsKey: null,
    originalKey: null,
    sourceCodec: 'flac',
    sampleRate: 44100,
    isPublic: true,
    uploadedByUserId: null,
    albumId: 'alb1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    album: {
      id: 'alb1',
      title: 'Midnight Horizons',
      slug: 'midnight-horizons',
      coverUrl: 'https://img/alb1.webp',
    },
    artists: [
      {
        order: 0,
        trackId: 'trk1',
        artistId: 'art1',
        artist: { id: 'art1', name: 'Neon Harbor', slug: 'neon-harbor', imageUrl: null },
      },
    ],
    ...overrides,
  } as unknown as TrackRow;
}

describe('toTrackDto', () => {
  it('maps relations and falls back to the album cover', () => {
    const dto = toTrackDto(fakeTrackRow());
    expect(dto.id).toBe('trk1');
    expect(dto.coverUrl).toBe('https://img/alb1.webp'); // track cover null → album cover
    expect(dto.artists).toEqual([
      { id: 'art1', name: 'Neon Harbor', slug: 'neon-harbor', imageUrl: null },
    ]);
    expect(dto.album?.slug).toBe('midnight-horizons');
    expect(dto.loudnessLufs).toBe(-11.4);
  });

  it('has null streamUrl without an hlsKey and a signed one with it', () => {
    expect(toTrackDto(fakeTrackRow()).streamUrl).toBeNull();
    const dto = toTrackDto(fakeTrackRow({ hlsKey: 'audio/trk1/master.m3u8' }));
    expect(dto.streamUrl).toContain('/api/v1/stream/trk1/manifest.m3u8?token=');
  });

  it('sets isLiked only when a likedSet is provided', () => {
    expect(toTrackDto(fakeTrackRow()).isLiked).toBeUndefined();
    expect(toTrackDto(fakeTrackRow(), { likedSet: new Set(['trk1']) }).isLiked).toBe(true);
    expect(toTrackDto(fakeTrackRow(), { likedSet: new Set() }).isLiked).toBe(false);
  });
});

describe('toAlbumDto', () => {
  it('derives trackCount and total duration', () => {
    const row = {
      id: 'alb1',
      title: 'Midnight Horizons',
      slug: 'midnight-horizons',
      type: 'ALBUM',
      coverUrl: null,
      dominantColor: null,
      releaseDate: new Date('2024-06-01T00:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      artists: [],
      genres: [{ genre: { name: 'Pop' } }],
      tracks: [{ durationMs: 100_000 }, { durationMs: 150_000 }],
    } as unknown as AlbumRow;
    const dto = toAlbumDto(row);
    expect(dto.trackCount).toBe(2);
    expect(dto.durationMs).toBe(250_000);
    expect(dto.releaseDate).toBe('2024-06-01T00:00:00.000Z');
    expect(dto.genres).toEqual(['Pop']);
  });
});

describe('toUploadDto', () => {
  it('converts BigInt sizes and attaches progress', () => {
    const dto = toUploadDto(
      {
        id: 'up1',
        fileName: 'song.flac',
        sizeBytes: 52_428_800n,
        status: 'TRANSCODING',
        error: null,
        trackId: null,
        createdAt: new Date('2026-02-02T00:00:00Z'),
      },
      63,
    );
    expect(dto.sizeBytes).toBe(52_428_800);
    expect(typeof dto.sizeBytes).toBe('number');
    expect(dto.progress).toBe(63);
    expect(dto.status).toBe('TRANSCODING');
  });
});

describe('applyLikedFlags', () => {
  it('overlays flags without mutating the input', () => {
    const tracks = [toTrackDto(fakeTrackRow()), toTrackDto(fakeTrackRow({ id: 'trk2' }))];
    const out = applyLikedFlags(tracks, new Set(['trk2']));
    expect(out.map((t) => t.isLiked)).toEqual([false, true]);
    expect(tracks[0]?.isLiked).toBeUndefined();
  });
});
