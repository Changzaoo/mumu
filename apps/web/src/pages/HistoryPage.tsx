/**
 * /history — listening history grouped by day (Hoje, Ontem, date),
 * with the exact played time on hover.
 */
import { useEffect, useMemo, useRef } from 'react';
import { History } from 'lucide-react';
import type { HistoryEntryDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHistory, useTrackLikes } from '@/features/library/api';
import { usePlayerStore } from '@/stores/playerStore';

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

interface DayGroup {
  label: string;
  entries: HistoryEntryDto[];
}

function groupByDay(entries: HistoryEntryDto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.playedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export default function HistoryPage() {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useHistory();
  const likes = useTrackLikes();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const entries = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const groups = useMemo(() => groupByDay(entries), [entries]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (list) => {
        if (list.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, entries.length]);

  if (isLoading) return <PageSkeleton variant="list" />;
  if (isError) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <History className="size-7 text-fg-muted" /> Histórico
      </h1>

      {entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nada por aqui ainda"
          description="Tudo que você ouvir aparece nesta linha do tempo."
        />
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="mb-2 px-2 text-lg font-semibold capitalize tracking-tight text-fg">
              {group.label}
            </h2>
            <TrackList>
              {group.entries.map((entry, index) => (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>
                    <div>
                      <TrackRow
                        track={entry.track}
                        index={index}
                        active={entry.track.id === currentTrack?.id}
                        playing={entry.track.id === currentTrack?.id && isPlaying}
                        liked={likes.isLiked(entry.track)}
                        onToggleLike={(liked) => likes.toggle(entry.track, liked)}
                        onPlay={() =>
                          playTrack(entry.track, { source: 'library', sourceId: 'history' })
                        }
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    Tocada às{' '}
                    {new Date(entry.playedAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TrackList>
          </section>
        ))
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
