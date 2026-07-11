import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { EqualizerPanel } from '@/components/media/EqualizerPanel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';
import { MiniPlayer } from '@/app/layout/MiniPlayer';
import { MobileNav } from '@/app/layout/MobileNav';
import { NowPlaying } from '@/app/layout/NowPlaying';
import { PlayerBar } from '@/app/layout/PlayerBar';
import { QueuePanel } from '@/app/layout/QueuePanel';
import { ScrollContainerContext } from '@/app/layout/scroll-context';
import { Sidebar } from '@/app/layout/Sidebar';
import { TopBar } from '@/app/layout/TopBar';

/** Screen-reader live region announcing track changes (DESIGN §10). */
function TrackAnnouncer() {
  const track = usePlayerStore((s) => s.currentTrack);
  return (
    <div aria-live="polite" className="sr-only">
      {track ? `Tocando ${track.title} de ${trackArtistNames(track)}` : ''}
    </div>
  );
}

/**
 * App shell (DESIGN §7):
 *
 *   ┌────────┬──────────────────────────┬─────────┐
 *   │Sidebar │ main (scroll) — TopBar   │ Queue*  │
 *   ├────────┴──────────────────────────┴─────────┤
 *   │ PlayerBar (88px, glass, fixed)              │
 *   └──────────────────────────────────────────────┘
 *
 * Mobile: MobileNav tabs + MiniPlayer. The player never unmounts — page
 * transitions (fade + 8px rise, 320ms) only wrap the <Outlet/>.
 */
export function AppShell() {
  const location = useLocation();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const queueOpen = useUiStore((s) => s.queueOpen);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Reset page scroll on navigation (keep player untouched).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <ScrollContainerContext.Provider value={scrollEl}>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
        <div className="flex min-h-0 flex-1">
          <Sidebar />

          <main
            ref={(node) => {
              scrollRef.current = node;
              setScrollEl(node);
            }}
            className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 lg:px-8"
          >
            <TopBar />
            <div
              className={cn(
                'mx-auto w-full max-w-[1600px]',
                // Clear the bottom chrome: mobile tabs (+ mini player) / desktop PlayerBar.
                hasTrack
                  ? 'pb-[calc(10rem+env(safe-area-inset-bottom))] md:pb-[calc(88px+2rem)]'
                  : 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8',
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          </main>

          {queueOpen && isDesktop && <QueuePanel />}
        </div>

        <PlayerBar />
        <MiniPlayer />
        <MobileNav />
        <NowPlaying />
        <EqualizerPanel />
        <TrackAnnouncer />
      </div>
    </ScrollContainerContext.Provider>
  );
}
