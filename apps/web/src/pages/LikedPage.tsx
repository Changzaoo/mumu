/**
 * /liked — "Curtidas": accent-gradient hero + virtualized track list with
 * play-all and shuffle. Cursor pagination loads as you approach the end.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Heart, Shuffle } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { VirtualList } from '@/components/media/VirtualList';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLikedTracks, useToggleLikeTrack } from '@/features/library/api';
import { formatCompactNumber } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

export default function LikedPage() {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLikedTracks();
  const toggleLike = useToggleLikeTrack();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracks = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  // Auto-load next page when the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, tracks.length]);

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (isError) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  const playAll = (index = 0): void => {
    if (tracks.length === 0) return;
    playQueue(tracks, index, { source: 'library', sourceId: 'liked' });
  };

  const playShuffled = (): void => {
    if (tracks.length === 0) return;
    if (!shuffle) toggleShuffle();
    playQueue(tracks, Math.floor(Math.random() * tracks.length), {
      source: 'library',
      sourceId: 'liked',
    });
  };

  return (
    <div className="space-y-6 py-4">
      <header className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-16 -top-32 h-96 bg-accent opacity-20 blur-[120px]"
        />
        <div className="relative flex flex-col items-center gap-6 pb-2 pt-4 md:flex-row md:items-end">
          <div className="grid size-44 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent/40 shadow-xl md:size-[232px]">
            <Heart className="size-16 fill-current text-accent-fg md:size-20" />
          </div>
          <div className="flex min-w-0 flex-col items-center gap-3 text-center md:items-start md:text-left">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-muted">
              Playlist
            </span>
            <h1 className="text-4xl font-bold tracking-tight text-fg md:text-5xl">Curtidas</h1>
            <p className="text-[13px] text-fg-muted">
              {formatCompactNumber(tracks.length)} faixas
              {hasNextPage ? ' carregadas' : ''}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <PlayButton
                size="lg"
                playing={false}
                onClick={() => playAll(0)}
                disabled={tracks.length === 0}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={playShuffled}
                disabled={tracks.length === 0}
              >
                <Shuffle /> Aleatório
              </Button>
            </div>
          </div>
        </div>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Nenhuma curtida ainda"
          description="Toque no coração de qualquer faixa para guardá-la aqui."
        />
      ) : (
        <TrackList aria-label="Faixas curtidas">
          <VirtualList
            items={tracks}
            estimateSize={56}
            renderItem={(track, index) => (
              <TrackRow
                track={track}
                index={index}
                active={track.id === currentTrack?.id}
                playing={track.id === currentTrack?.id && isPlaying}
                liked
                onToggleLike={(liked) => toggleLike.mutate({ track, liked })}
                onPlay={() => playAll(index)}
              />
            )}
          />
        </TrackList>
      )}

      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}
    </div>
  );
}
