import { useMemo, useSyncExternalStore } from 'react';
import { Building2, Play } from 'lucide-react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { useLabelTopTracks } from '@/lib/labelTop';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function LabelLocalPage() {
  const { name = '' } = useParams<{ name: string }>();
  const label = decodeURIComponent(name);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const baseTracks = useMemo(() => localLibrary.labelTracks(label), [entries, label]);
  const artists = useMemo(
    () =>
      [...new Set(baseTracks.map((t) => t.artists[0]?.name?.trim()).filter(Boolean))]
        .slice(0, 6)
        .join(', '),
    [baseTracks],
  );
  const { tracks, ranked, rankedArtists } = useLabelTopTracks(label, baseTracks);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'library', sourceId: `label:${label}` })
      : undefined;

  if (tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Building2}
          title={label}
          description="Você ainda não tem músicas dessa gravadora no aparelho."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
          Gravadora
        </p>
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-fg">
          <Building2 className="size-8 text-fg-muted" /> {label}
        </h1>
        <p className="text-sm text-fg-muted">
          {tracks.length} {tracks.length === 1 ? 'música' : 'músicas'}
          {artists ? ` · ${artists}` : ''}
        </p>
        <button
          type="button"
          onClick={() => play(0)}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
        >
          <Play className="size-4 fill-current" /> Tocar
        </button>
        {ranked && (
          <p className="text-[12px] text-fg-subtle">
            Ordenado por popularidade na internet (sinal dos tops de {rankedArtists}{' '}
            {rankedArtists === 1 ? 'artista' : 'artistas'} da gravadora).
          </p>
        )}
      </header>

      <TrackList header aria-label={`Músicas da gravadora ${label}`}>
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
