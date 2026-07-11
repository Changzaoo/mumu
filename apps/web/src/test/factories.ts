import type { TrackDto } from '@aurial/shared';

/** Minimal valid TrackDto for unit tests. */
export function makeTrack(id: string, overrides: Partial<TrackDto> = {}): TrackDto {
  return {
    id,
    title: `Track ${id}`,
    durationMs: 225_000,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: -10,
    isLiked: false,
    album: { id: `album-${id}`, title: `Album ${id}`, slug: `album-${id}`, coverUrl: null },
    artists: [{ id: `artist-${id}`, name: `Artist ${id}`, slug: `artist-${id}`, imageUrl: null }],
    streamUrl: `https://cdn.aurial.test/audio/${id}/master.m3u8`,
    uploadedByUserId: null,
    ...overrides,
  };
}
