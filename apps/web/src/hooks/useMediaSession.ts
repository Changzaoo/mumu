import { useEffect } from 'react';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Media Session API — OS-level metadata + hardware/lock-screen controls.
 * Mount once (RootLayout).
 */
export function useMediaSession(): void {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const playbackRate = usePlayerStore((s) => s.playbackRate);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork = track.coverUrl
      ? [
          { src: track.coverUrl, sizes: '300x300', type: 'image/webp' },
          { src: track.coverUrl, sizes: '512x512', type: 'image/webp' },
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: trackArtistNames(track),
      album: track.album?.title ?? '',
      artwork,
    });
  }, [track]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = track ? (isPlaying ? 'playing' : 'paused') : 'none';
  }, [track, isPlaying]);

  useEffect(() => {
    if (
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) {
      return;
    }
    if (duration > 0 && Number.isFinite(duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate,
          position: Math.min(progress, duration),
        });
      } catch {
        /* invalid transient values are fine to skip */
      }
    }
  }, [progress, duration, playbackRate]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const { play, pause, next, prev, seek } = usePlayerStore.getState();
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', () => play()],
      ['pause', () => pause()],
      ['nexttrack', () => next()],
      ['previoustrack', () => prev()],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') seek(details.seekTime);
        },
      ],
      ['seekbackward', (d) => seek(usePlayerStore.getState().progress - (d.seekOffset ?? 10))],
      ['seekforward', (d) => seek(usePlayerStore.getState().progress + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action unsupported on this platform */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* noop */
        }
      }
    };
  }, []);
}
