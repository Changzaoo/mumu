/**
 * settingsStore — persisted user preferences with DOM side effects.
 *
 * Theme/high-contrast/font-scale are applied to <html> here (single source of
 * truth); index.html replays the persisted theme before first paint.
 * Audio-related settings (EQ, normalization, crossfade, gapless) are consumed
 * by `initPlayerEngine()` in playerStore.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EQ_BANDS_HZ, EQ_PRESETS, type AudioQuality } from '@aurial/shared';
import { clamp } from '@/lib/utils';

export type ThemeSetting = 'dark' | 'light' | 'system';
export type ReducedMotionSetting = 'system' | 'on' | 'off';

export interface EqSettings {
  enabled: boolean;
  /** dB gains aligned with EQ_BANDS_HZ (10 bands, −12..12). */
  gains: number[];
  /** Name of the active EQ_PRESETS entry, or null when customized. */
  preset: string | null;
}

export interface SettingsState {
  theme: ThemeSetting;
  language: string;
  audioQuality: AudioQuality;
  crossfadeSeconds: number;
  gapless: boolean;
  normalizeVolume: boolean;
  eq: EqSettings;
  sleepTimerMinutes: number | null;
  /** Root font multiplier 0.875–1.25. */
  fontScale: number;
  highContrast: boolean;
  reducedMotion: ReducedMotionSetting;
  /** Account-style prefs, kept on-device (no backend in the P2P topology). */
  notifications: boolean;
  /** When true, plays are not recorded to the local history. */
  privateSession: boolean;

  setTheme: (theme: ThemeSetting) => void;
  setLanguage: (language: string) => void;
  setAudioQuality: (quality: AudioQuality) => void;
  setCrossfadeSeconds: (seconds: number) => void;
  setGapless: (enabled: boolean) => void;
  setNormalizeVolume: (enabled: boolean) => void;
  setEqEnabled: (enabled: boolean) => void;
  setEqGain: (band: number, gainDb: number) => void;
  setEqPreset: (preset: string) => void;
  setSleepTimer: (minutes: number | null) => void;
  setFontScale: (scale: number) => void;
  setHighContrast: (enabled: boolean) => void;
  setReducedMotion: (mode: ReducedMotionSetting) => void;
  setNotifications: (enabled: boolean) => void;
  setPrivateSession: (enabled: boolean) => void;
}

const FLAT_EQ: number[] = EQ_BANDS_HZ.map(() => 0);

export function resolveTheme(theme: ThemeSetting): 'dark' | 'light' {
  if (theme === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
}

function applyDomSettings(
  state: Pick<SettingsState, 'theme' | 'fontScale' | 'highContrast'>,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveTheme(state.theme);
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('hc', state.highContrast);
  root.style.setProperty('--font-scale', String(state.fontScale));
  // Keep the browser chrome color in sync (PWA polish).
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  const color = resolved === 'dark' ? '#0A0A0C' : '#FCFCFC';
  if (meta) meta.content = color;
  else {
    const el = document.createElement('meta');
    el.name = 'theme-color';
    el.content = color;
    document.head.appendChild(el);
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      language: 'pt-BR',
      audioQuality: 'high',
      crossfadeSeconds: 0,
      gapless: true,
      normalizeVolume: true,
      eq: { enabled: false, gains: [...FLAT_EQ], preset: 'flat' },
      sleepTimerMinutes: null,
      fontScale: 1,
      highContrast: false,
      reducedMotion: 'system',
      notifications: true,
      privateSession: false,

      setTheme: (theme) => {
        set({ theme });
        applyDomSettings(get());
      },
      setLanguage: (language) => set({ language }),
      setAudioQuality: (audioQuality) => set({ audioQuality }),
      setCrossfadeSeconds: (seconds) => set({ crossfadeSeconds: clamp(seconds, 0, 12) }),
      setGapless: (gapless) => set({ gapless }),
      setNormalizeVolume: (normalizeVolume) => set({ normalizeVolume }),
      setEqEnabled: (enabled) => set((state) => ({ eq: { ...state.eq, enabled } })),
      setEqGain: (band, gainDb) =>
        set((state) => {
          const gains = [...state.eq.gains];
          if (band >= 0 && band < gains.length) gains[band] = clamp(gainDb, -12, 12);
          return { eq: { ...state.eq, gains, preset: null } };
        }),
      setEqPreset: (preset) => {
        const gains = EQ_PRESETS[preset];
        if (!gains) return;
        set((state) => ({ eq: { ...state.eq, gains: [...gains], preset } }));
      },
      setSleepTimer: (sleepTimerMinutes) => set({ sleepTimerMinutes }),
      setFontScale: (scale) => {
        set({ fontScale: clamp(scale, 0.875, 1.25) });
        applyDomSettings(get());
      },
      setHighContrast: (highContrast) => {
        set({ highContrast });
        applyDomSettings(get());
      },
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setNotifications: (notifications) => set({ notifications }),
      setPrivateSession: (privateSession) => set({ privateSession }),
    }),
    {
      name: 'aurial:settings',
      onRehydrateStorage: () => (state) => {
        if (state) applyDomSettings(state);
      },
    },
  ),
);

/**
 * Call once on boot: applies persisted settings to the DOM and tracks
 * prefers-color-scheme changes while theme === 'system'.
 * Returns an unsubscribe function.
 */
export function initSettings(): () => void {
  applyDomSettings(useSettingsStore.getState());
  if (typeof window === 'undefined') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    if (useSettingsStore.getState().theme === 'system') {
      applyDomSettings(useSettingsStore.getState());
    }
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
