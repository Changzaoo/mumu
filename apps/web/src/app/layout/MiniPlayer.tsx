import { AnimatePresence, motion } from 'framer-motion';
import { Music, Pause, Play, SkipForward } from 'lucide-react';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * 64px mini player docked above the mobile tabs (<768px).
 * Hairline progress at the bottom edge; tap opens NowPlaying.
 */
export function MiniPlayer() {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const setNowPlayingOpen = useUiStore((s) => s.setNowPlayingOpen);

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          key="mini-player"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="glass fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-40 h-16 overflow-hidden rounded-xl md:hidden"
        >
          <div className="flex h-full items-center gap-3 px-3">
            <button
              type="button"
              aria-label="Abrir reprodução em tela cheia"
              onClick={() => setNowPlayingOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="relative size-11 shrink-0 overflow-hidden rounded-sm bg-fg/6">
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center text-fg-subtle">
                    <Music className="size-4" />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="line-clamp-1 text-sm font-medium text-fg">{track.title}</span>
                <span className="line-clamp-1 text-xs text-fg-muted">
                  {trackArtistNames(track)}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              onClick={toggle}
              className="grid size-10 shrink-0 place-items-center rounded-full text-fg active:scale-95"
            >
              {isPlaying ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="ml-0.5 size-5 fill-current" />
              )}
            </button>
            <button
              type="button"
              aria-label="Próxima"
              onClick={next}
              className="grid size-10 shrink-0 place-items-center rounded-full text-fg-muted active:scale-95"
            >
              <SkipForward className="size-5 fill-current" />
            </button>
          </div>
          {/* progress hairline */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-fg/10">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
