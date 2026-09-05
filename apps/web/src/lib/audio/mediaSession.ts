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
import type { TrackDto } from '@radinho/shared';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore, type PlayerState } from '@/stores/playerStore';

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/** Artwork entries for the lock screen — one cover, a few size hints.
 *  Sem capa, usa o ícone do APP — a notificação nunca fica com o do navegador. */
function artworkFor(track: TrackDto): MediaImage[] {
  const url = track.coverUrl;
  if (!url) {
    return [
      { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/pwa-maskable-192.png', sizes: '192x192', type: 'image/png' },
    ];
  }
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
    // Em try/catch como todo o resto daqui (RF4): a tela de bloqueio é enfeite,
    // e nenhum enfeite pode derrubar a assinatura da store — que roda a cada
    // `setState` do player, ou seja, no meio da música.
    if (state.isPlaying !== lastPlaying) {
      lastPlaying = state.isPlaying;
      try {
        ms.playbackState = state.isPlaying ? 'playing' : 'paused';
      } catch {
        /* estado não suportado por este navegador — ignora */
      }
    }

    // ── BARREIRA DO `setPositionState` (RF2/RF4) ────────────────────
    //
    // Ele LANÇA com qualquer entrada fora do contrato, e as entradas fora do
    // contrato são o dia a dia deste player: `duration` vale `NaN` antes da
    // metadata e `Infinity` em stream sem `Content-Length`; `position` pode
    // passar de `duration` no instante da troca de faixa, quando o playhead já
    // é o da faixa nova e a duração ainda é a da velha; `playbackRate` vem de
    // preferência persistida e já chegou como `0`.
    //
    // Nada disso pode chegar lá. O `try/catch` continua por baixo porque a
    // implementação varia entre navegadores, mas ele é a última linha, não a
    // primeira: silenciar exceção não conserta a barra da tela de bloqueio.
    const now = Date.now();
    if (now - lastPositionCommit > 1000 && typeof ms.setPositionState === 'function') {
      lastPositionCommit = now;
      const duration = state.duration;
      const rate = state.playbackRate;
      if (Number.isFinite(duration) && duration > 0) {
        const position = Number.isFinite(state.progress)
          ? Math.min(Math.max(0, state.progress), duration)
          : 0;
        const playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
        try {
          ms.setPositionState({ duration, position, playbackRate });
        } catch {
          /* transient out-of-range during load — ignore */
        }
      }
    }
  };

  sync(store.getState());
  store.subscribe(sync);
}
