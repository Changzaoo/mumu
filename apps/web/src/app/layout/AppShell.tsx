import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import { EqualizerPanel } from '@/components/media/EqualizerPanel';
import { RemotePlaybackBanner } from '@/components/media/RemotePlaybackBanner';
import { ShareDialogHost } from '@/components/media/ShareDialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { recordNavigation } from '@/lib/telemetry/telemetry';
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

  // Reset page scroll on navigation (keep player untouched) + telemetry.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    recordNavigation(location.pathname);
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
            className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 md:px-6 lg:px-8"
          >
            <TopBar />
            <div
              className={cn(
                'mx-auto w-full max-w-[1600px]',
                // Clear the bottom chrome: mobile tabs (+ mini player) / desktop PlayerBar.
                hasTrack
                  ? 'pb-[calc(10.5rem+env(safe-area-inset-bottom))] md:pb-[calc(88px+2rem)]'
                  : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8',
              )}
            >
              {/* Instant-feel navigation (Spotify-like): no exit animation, no
                  layout pop — just a 120ms opacity ease-in on the new page. */}
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12, ease: 'linear' }}
              >
                <Outlet />
              </motion.div>
            </div>
          </main>

          {queueOpen && isDesktop && <QueuePanel />}
        </div>

        <PlayerBar />
        <MiniPlayer />
        <MobileNav />
        <NowPlaying />
        <EqualizerPanel />
        <ShareDialogHost />
        <RemotePlaybackBanner />
        <TrackAnnouncer />
      </div>
    </ScrollContainerContext.Provider>
  );
}
