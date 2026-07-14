/**
 * /genero/:name — every track in YOUR library tagged with this genre (the genre
 * is assigned by the AI identity agent during enrichment).
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Play, Tag } from 'lucide-react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function GenreLocalPage() {
  const { name = '' } = useParams<{ name: string }>();
  const genre = decodeURIComponent(name);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const tracks = useMemo(() => localLibrary.genreTracks(genre), [entries, genre]);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'library', sourceId: `genre:${genre}` })
      : undefined;

  if (tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Tag}
          title={genre}
          description="Você ainda não tem músicas desse gênero no aparelho."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">Gênero</p>
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-fg">
          <Tag className="size-8 text-fg-muted" /> {genre}
        </h1>
        <p className="text-sm text-fg-muted">
          {tracks.length} {tracks.length === 1 ? 'música' : 'músicas'}
        </p>
        <button
          type="button"
          onClick={() => play(0)}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
        >
          <Play className="size-4 fill-current" /> Tocar
        </button>
      </header>

      <TrackList header aria-label={`Músicas de ${genre}`}>
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
