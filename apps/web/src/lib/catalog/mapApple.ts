/**
 * Apple/iTunes → Aurial domain mapper.
 *
 * Maps an iTunes song row to a `TrackDto`. Ids are namespaced (`itunes:<id>`)
 * so they never collide with local (`local:<uuid>`), Audius (`audius:<id>`) or
 * backend ids.
 *
 * LEGAL / stream-only: the playable source is Apple's official 30-second
 * `previewUrl`, so `durationMs` is fixed at 30000 (the seek bar matches the
 * clip, not the full song). `downloadUrl` is always null and `previewOnly` is
 * true — these tracks are never downloaded, offline-cached or P2P-shared.
 */
import type { TrackDto } from '@aurial/shared';
import type { AppleSong } from '@/lib/catalog/itunes';

/** Apple preview clip length in ms (fixed — matches the seek bar). */
const PREVIEW_DURATION_MS = 30_000;

/** Upgrade the 100×100 artwork URL to 600×600. */
function hiResArtwork(url: string): string {
  return url.replace('100x100bb', '600x600bb');
}

export function appleSongToDto(song: AppleSong): TrackDto {
  const cover = song.artworkUrl100 ? hiResArtwork(song.artworkUrl100) : null;
  return {
    id: `itunes:${song.trackId}`,
    title: song.trackName,
    durationMs: PREVIEW_DURATION_MS,
    trackNumber: null,
    discNumber: null,
    explicit: song.trackExplicitness === 'explicit',
    playsCount: 0,
    coverUrl: cover,
    dominantColor: null,
    loudnessLufs: null,
    album: {
      id: `itunes-album:${song.collectionId}`,
      title: song.collectionName,
      slug: '',
      coverUrl: cover,
    },
    artists: [
      {
        id: `itunes-artist:${song.artistId}`,
        name: song.artistName,
        slug: '',
        imageUrl: null,
      },
    ],
    streamUrl: song.previewUrl,
    // Stream-only 30s preview: never downloadable / offline / P2P-shareable.
    downloadUrl: null,
    previewOnly: true,
    genre: song.primaryGenreName ?? null,
    uploadedByUserId: null,
  };
}
