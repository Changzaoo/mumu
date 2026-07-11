import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MicVocal } from 'lucide-react';
import type { LyricsDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

export interface LyricsViewProps {
  trackId: string;
  className?: string;
}

/**
 * Synced lyrics pane: active line highlighted + auto-scroll (DESIGN §8).
 * Click a line to seek (synced lyrics only).
 */
export function LyricsView({ trackId, className }: LyricsViewProps) {
  const progress = usePlayerStore((s) => s.progress);
  const seek = usePlayerStore((s) => s.seek);

  const { data: lyrics, isLoading } = useQuery({
    queryKey: ['lyrics', trackId],
    queryFn: async () => (await api.get<LyricsDto>(`/tracks/${trackId}/lyrics`)).data,
    staleTime: Infinity,
    retry: false,
  });

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    const positionMs = progress * 1000;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if ((lyrics.lines[i]?.timeMs ?? Infinity) <= positionMs) index = i;
      else break;
    }
    return index;
  }, [lyrics, progress]);

  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  if (isLoading) {
    return (
      <div className={cn('space-y-4 py-6', className)}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
        ))}
      </div>
    );
  }

  if (!lyrics || lyrics.lines.length === 0) {
    return (
      <EmptyState
        icon={MicVocal}
        title="Sem letra disponível"
        description="Esta faixa ainda não tem letra sincronizada."
        className={className}
      />
    );
  }

  return (
    <div
      className={cn('no-scrollbar h-full space-y-1 overflow-y-auto py-8', className)}
      aria-label="Letra da música"
    >
      {lyrics.lines.map((line, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${line.timeMs}-${index}`}
            ref={active ? activeRef : undefined}
            type="button"
            disabled={!lyrics.synced}
            onClick={() => seek(line.timeMs / 1000)}
            className={cn(
              'block w-full rounded-lg px-3 py-2 text-left text-xl font-semibold tracking-tight transition-colors duration-200',
              lyrics.synced && 'cursor-pointer hover:bg-fg/5',
              active ? 'text-fg' : 'text-fg-muted/60',
            )}
          >
            {line.text || '♪'}
          </button>
        );
      })}
      {lyrics.source && (
        <p className="px-3 pt-6 text-[11px] text-fg-subtle">Fonte: {lyrics.source}</p>
      )}
    </div>
  );
}
