/** Audio qualities available in the HLS ladder (AAC bitrates in kbps). */
export const AUDIO_QUALITIES = ['low', 'normal', 'high', 'lossless'] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];

export const AUDIO_BITRATES: Record<Exclude<AudioQuality, 'lossless'>, number> = {
  low: 96,
  normal: 160,
  high: 320,
};

/** Loudness normalization target (streaming standard). */
export const REPLAY_GAIN_TARGET_LUFS = -14;

export const ACCEPTED_AUDIO_MIME = [
  'audio/mpeg',
  'audio/flac',
  'audio/x-flac',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/opus',
] as const;

export const ACCEPTED_AUDIO_EXT = [
  '.mp3',
  '.flac',
  '.wav',
  '.aac',
  '.m4a',
  '.alac',
  '.ogg',
  '.opus',
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB (FLAC/WAV friendly)
export const WAVEFORM_PEAKS = 1024;

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

export const USER_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const REPEAT_MODES = ['off', 'all', 'one'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export const MOODS = [
  'chill',
  'focus',
  'workout',
  'gaming',
  'lofi',
  'party',
  'sleep',
  'romance',
  'sad',
  'happy',
] as const;
export type Mood = (typeof MOODS)[number];

export const EQ_BANDS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  rock: [4, 3, 1, 0, -1, 0, 1, 3, 4, 4],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 3, 3, 2],
};

export const STREAM_TOKEN_TTL_SECONDS = 6 * 60 * 60; // 6h signed stream URLs
