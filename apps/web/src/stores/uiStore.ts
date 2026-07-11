/**
 * uiStore — ephemeral interface state (except sidebarCollapsed, persisted).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveModal = 'equalizer' | (string & {}) | null;

export interface UiState {
  /** Persisted: sidebar in 72px icon mode. */
  sidebarCollapsed: boolean;
  queueOpen: boolean;
  nowPlayingOpen: boolean;
  /** Lyrics pane inside NowPlaying. */
  lyricsOpen: boolean;
  commandOpen: boolean;
  activeModal: ActiveModal;

  toggleSidebar: () => void;
  setQueueOpen: (open: boolean) => void;
  toggleQueue: () => void;
  setNowPlayingOpen: (open: boolean) => void;
  toggleNowPlaying: () => void;
  setLyricsOpen: (open: boolean) => void;
  toggleLyrics: () => void;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  setActiveModal: (modal: ActiveModal) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      queueOpen: false,
      nowPlayingOpen: false,
      lyricsOpen: false,
      commandOpen: false,
      activeModal: null,

      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setQueueOpen: (queueOpen) => set({ queueOpen }),
      toggleQueue: () => set({ queueOpen: !get().queueOpen }),
      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
      toggleNowPlaying: () => set({ nowPlayingOpen: !get().nowPlayingOpen }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      toggleLyrics: () => set({ lyricsOpen: !get().lyricsOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleCommand: () => set({ commandOpen: !get().commandOpen }),
      setActiveModal: (activeModal) => set({ activeModal }),
    }),
    {
      name: 'aurial:ui',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
