/** 245000 → "4:05"; hours when needed → "1:04:05". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Long-form: 3723000 → "1 h 2 min". */
export function formatDurationLong(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

export function formatCompactNumber(n: number, locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  return `${(bytes / 2 ** (10 * i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** ReplayGain: gain in dB to reach target loudness from a track's integrated LUFS. */
export function replayGainDb(trackLufs: number, targetLufs = -14): number {
  const gain = targetLufs - trackLufs;
  // Clamp: never boost more than 12 dB (avoids blowing up quiet/noisy tracks).
  return Math.max(-24, Math.min(12, gain));
}

/** dB → linear amplitude multiplier for a Web Audio GainNode. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}
