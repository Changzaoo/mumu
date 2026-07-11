import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { TrackDto } from '@aurial/shared';

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Re-export shared formatters so pages import from one place.
export {
  formatBytes,
  formatCompactNumber,
  formatDuration,
  formatDurationLong,
} from '@aurial/shared';

/** Seconds → "m:ss" (player timestamps; formatDuration takes ms). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "Artist A, Artist B" from a track's artist list. */
export function trackArtistNames(track: Pick<TrackDto, 'artists'>): string {
  return track.artists.map((a) => a.name).join(', ');
}

/** Clamp helper used across player math. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
