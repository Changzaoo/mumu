import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Global shortcuts (mount once in RootLayout):
 *   Space play/pause · ←/→ seek ±10s · ↑/↓ volume · M mute · S shuffle
 *   R repeat · Q queue · F now playing · ⌘K / Ctrl+K command palette
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Command palette works everywhere, even while typing.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useUiStore.getState().toggleCommand();
        return;
      }
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

      const player = usePlayerStore.getState();
      const ui = useUiStore.getState();

      switch (event.key) {
        case ' ':
          event.preventDefault(); // avoid page scroll
          player.toggle();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          player.seek(player.progress - 10);
          break;
        case 'ArrowRight':
          event.preventDefault();
          player.seek(player.progress + 10);
          break;
        case 'ArrowUp':
          event.preventDefault();
          player.setVolume(player.volume + 0.05);
          break;
        case 'ArrowDown':
          event.preventDefault();
          player.setVolume(player.volume - 0.05);
          break;
        case 'm':
        case 'M':
          player.toggleMute();
          break;
        case 's':
        case 'S':
          player.toggleShuffle();
          break;
        case 'r':
        case 'R':
          player.cycleRepeat();
          break;
        case 'q':
        case 'Q':
          ui.toggleQueue();
          break;
        case 'f':
        case 'F':
          if (player.currentTrack) ui.toggleNowPlaying();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
