import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MicVocal } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { fetchLyrics } from '@/lib/lyrics/lyrics';
import { syncLyricsFromAudio } from '@/lib/lyrics/syncFromAudio';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Acende a linha um pouco antes do timestamp — sensação de estar em sincronia. */
const LEAD_MS = 180;

export interface LyricsViewProps {
  track: TrackDto;
  className?: string;
}

/**
 * Synced lyrics pane (LRCLIB): active line highlighted + auto-scroll.
 * Click a line to seek (synced lyrics only).
 */
export function LyricsView({ track, className }: LyricsViewProps) {
  const seek = usePlayerStore((s) => s.seek);
  const isCurrent = usePlayerStore((s) => s.currentTrack?.id === track.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const { data: lyrics, isLoading } = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: async () => {
      const found = await fetchLyrics(track);
      // Letra existe mas sem tempo: tenta ganhar sincronia a partir do áudio
      // que já está no aparelho. Se não rolar, seguimos com a letra plana —
      // por isso o resultado nulo cai de volta em `found`.
      if (found && !found.synced) {
        const synced = await syncLyricsFromAudio(track).catch(() => null);
        if (synced) return synced;
      }
      return found;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Karaokê fluido: a posição do STORE é throttled a ~5/s (passos visíveis e
  // ~200ms atrasados). Amostramos a posição REAL do engine por rAF — mas só da
  // faixa que está tocando, para não destacar linha na letra de outra faixa.
  const [positionMs, setPositionMs] = useState(0);
  const synced = Boolean(lyrics?.synced) && isCurrent;
  useEffect(() => {
    if (!synced) return;
    let raf = 0;
    const tick = (): void => {
      setPositionMs(audioEngine.getPosition() * 1000 + LEAD_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, isPlaying, track.id]);

  const activeIndex = useMemo(() => {
    if (!synced || !lyrics) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if ((lyrics.lines[i]?.timeMs ?? Infinity) <= positionMs) index = i;
      else break;
    }
    return index;
  }, [synced, lyrics, positionMs]);

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
        description="Não encontramos a letra desta faixa."
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
