/**
 * Media Session integration — OS-level "now playing".
 *
 * Wires the player store to the browser's Media Session API so the current
 * track shows on the phone lock screen / notification shade / desktop media
 * keys, with artwork and working play·pause·prev·next·seek controls. Declaring
 * an active media session also signals the OS to keep audio playing while the
 * app is backgrounded (the audio element itself keeps streaming).
 *
 * No-ops on browsers without the API. Called once from initPlayerEngine.
 */
import type { TrackDto } from '@aurial/shared';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore, type PlayerState } from '@/stores/playerStore';

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/** Artwork entries for the lock screen — one cover, a few size hints. */
function artworkFor(track: TrackDto): MediaImage[] {
  const url = track.coverUrl;
  if (!url) return [];
  const type = url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return [
    { src: url, sizes: '512x512', type },
    { src: url, sizes: '256x256', type },
    { src: url, sizes: '96x96', type },
  ];
}

export function initMediaSession(): void {
  if (!supported()) return;
  const ms = navigator.mediaSession;
  const store = usePlayerStore;

  const on = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action unsupported by this browser — ignore */
    }
  };

  on('play', () => store.getState().play());
  on('pause', () => store.getState().pause());
  on('previoustrack', () => store.getState().prev());
  on('nexttrack', () => store.getState().next());
  on('stop', () => store.getState().pause());
  on('seekbackward', (d) => {
    const s = store.getState();
    s.seek(Math.max(0, s.progress - (d.seekOffset ?? 10)));
  });
  on('seekforward', (d) => {
    const s = store.getState();
    s.seek(Math.min(s.duration || s.progress, s.progress + (d.seekOffset ?? 10)));
  });
  on('seekto', (d) => {
    if (typeof d.seekTime === 'number') store.getState().seek(d.seekTime);
  });

  let lastMetaKey = '';
  let lastPlaying: boolean | null = null;
  let lastPositionCommit = 0;

  const sync = (state: PlayerState): void => {
    const track = state.currentTrack;

    // Metadata — refresh when the track OR its (late-arriving) cover changes.
    const metaKey = track ? `${track.id}|${track.coverUrl ?? ''}` : '';
    if (metaKey !== lastMetaKey) {
      lastMetaKey = metaKey;
      try {
        ms.metadata = track
          ? new MediaMetadata({
              title: track.title,
              artist: trackArtistNames(track),
              album: track.album?.title ?? '',
              artwork: artworkFor(track),
            })
          : null;
      } catch {
        /* MediaMetadata unavailable — ignore */
      }
    }

    // Playback state drives the play/pause glyph on the lock screen.
    if (state.isPlaying !== lastPlaying) {
      lastPlaying = state.isPlaying;
      ms.playbackState = state.isPlaying ? 'playing' : 'paused';
    }

    // Scrubber position (throttled; guarded — setPositionState throws on bad input).
    const now = Date.now();
    if (now - lastPositionCommit > 1000 && typeof ms.setPositionState === 'function') {
      lastPositionCommit = now;
      const duration = state.duration;
      if (Number.isFinite(duration) && duration > 0) {
        try {
          ms.setPositionState({
            duration,
            position: Math.min(Math.max(0, state.progress), duration),
            playbackRate: state.playbackRate || 1,
          });
        } catch {
          /* transient out-of-range during load — ignore */
        }
      }
    }
  };

  sync(store.getState());
  store.subscribe(sync);
}
