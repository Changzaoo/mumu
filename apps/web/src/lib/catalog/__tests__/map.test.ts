import { describe, expect, it } from 'vitest';
import { audiusTrackToDto, type AudiusTrack } from '@/lib/catalog/map';

const sample: AudiusTrack = {
  id: 'abc123',
  title: 'Test Track',
  user: {
    id: 'u1',
    name: 'Cool Artist',
    handle: 'coolartist',
    profile_picture: { '150x150': 'http://img/150', '480x480': 'http://img/480' },
  },
  duration: 200,
  artwork: { '480x480': 'http://art/480' },
  play_count: 42,
  genre: 'Electronic',
};

describe('audiusTrackToDto', () => {
  it('maps an Audius track to a playable TrackDto', () => {
    const dto = audiusTrackToDto(sample);

    expect(dto.id).toBe('audius:abc123');
    expect(dto.title).toBe('Test Track');
    expect(dto.durationMs).toBe(200_000);
    expect(dto.coverUrl).toBe('http://art/480');
    expect(dto.playsCount).toBe(42);
    expect(dto.album).toBeNull();
    expect(dto.explicit).toBe(false);
    expect(dto.loudnessLufs).toBeNull();

    expect(dto.artists).toHaveLength(1);
    expect(dto.artists[0]).toMatchObject({
      id: 'audius-user:u1',
      name: 'Cool Artist',
      slug: 'coolartist',
      imageUrl: 'http://img/150',
    });

    // Stream + download point at the Audius stream endpoint (directly playable).
    expect(dto.streamUrl).toContain('/v1/tracks/abc123/stream?app_name=Aurial');
    expect(dto.downloadUrl).toBe(dto.streamUrl);
    expect(dto.uploadedByUserId).toBeNull();
  });

  it('falls back gracefully when optional fields are missing', () => {
    const minimal: AudiusTrack = {
      id: 'x',
      title: 'X',
      user: { id: 'u', name: 'N', handle: 'h' },
      duration: 0,
    };
    const dto = audiusTrackToDto(minimal);

    expect(dto.coverUrl).toBeNull();
    expect(dto.artists[0]?.imageUrl).toBeNull();
    expect(dto.playsCount).toBe(0);
    expect(dto.durationMs).toBe(0);
  });
});
