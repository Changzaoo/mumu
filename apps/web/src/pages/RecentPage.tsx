/**
 * /recentes — TODAS as músicas da biblioteca ordenadas pela data em que foram
 * adicionadas (mais novas primeiro). É a página completa do "Mostrar tudo" da
 * prateleira "Adicionadas recentemente" da Home.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Clock3, Play } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function RecentPage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const tracks = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
        .map((e) => e.track),
    [entries],
  );

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'library', sourceId: 'recentes' })
      : undefined;

  if (tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Clock3}
          title="Nada por aqui ainda"
          description="As músicas que você adicionar aparecem aqui, das mais novas para as mais antigas."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
          Biblioteca
        </p>
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-fg">
          <Clock3 className="size-8 text-fg-muted" /> Adicionadas recentemente
        </h1>
        <p className="text-sm text-fg-muted">
          {tracks.length} {tracks.length === 1 ? 'música' : 'músicas'} · mais novas primeiro
        </p>
        <button
          type="button"
          onClick={() => play(0)}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
        >
          <Play className="size-4 fill-current" /> Tocar
        </button>
      </header>

      <TrackList header aria-label="Adicionadas recentemente">
        {tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            active={track.id === currentTrack?.id}
            playing={track.id === currentTrack?.id && isPlaying}
            liked={likes.isLiked(track)}
            onToggleLike={(liked) => likes.toggle(track, liked)}
            onPlay={() => play(index)}
          />
        ))}
      </TrackList>
    </div>
  );
}
