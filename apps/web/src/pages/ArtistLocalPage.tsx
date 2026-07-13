/**
 * /artista/:name — a Spotify-style page for an artist in YOUR library: their
 * albums plus every track of theirs you have, all from local metadata.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Disc3, MicVocal, Play } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { MediaCard } from '@/components/media/MediaCard';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import { useArtistImage } from '@/lib/artistImage';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function ArtistLocalPage() {
  const { name = '' } = useParams<{ name: string }>();
  const artist = decodeURIComponent(name);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const tracks = useMemo(() => localLibrary.artistTracks(artist), [entries, artist]);
  const albums = useMemo(() => localLibrary.artistAlbums(artist), [entries, artist]);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const photo = useArtistImage(artist);
  const cover = photo ?? tracks.find((t) => t.coverUrl)?.coverUrl ?? null;
  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'artist', sourceId: artist })
      : undefined;

  if (tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={MicVocal}
          title={artist}
          description="Você ainda não tem músicas desse artista no aparelho."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4">
      {/* Header */}
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <span className="size-40 shrink-0 overflow-hidden rounded-full bg-fg/6 shadow-xl">
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-fg-subtle">
              <MicVocal className="size-12" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            Artista
          </p>
          <h1 className="mt-1 line-clamp-2 text-4xl font-bold tracking-tight text-fg">{artist}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {tracks.length} {tracks.length === 1 ? 'música' : 'músicas'}
            {albums.length > 0 && ` · ${albums.length} ${albums.length === 1 ? 'álbum' : 'álbuns'}`}
          </p>
          <button
            type="button"
            onClick={() => play(0)}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
          >
            <Play className="size-4 fill-current" /> Tocar
          </button>
        </div>
      </header>

      {/* Albums */}
      {albums.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <Disc3 className="size-5 text-fg-muted" /> Álbuns
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {albums.map((album) => (
              <MediaCard
                key={album.key}
                title={album.title}
                subtitle={`${album.tracks.length} faixas`}
                imageUrl={album.coverUrl}
                to={`/disco/${encodeURIComponent(album.key)}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* All tracks */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Músicas</h2>
        <TrackList aria-label={`Músicas de ${artist}`}>
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
      </section>

      <p className="text-[12px] text-fg-subtle">
        <Link to="/dispositivo" className="hover:text-fg">
          Ver tudo no dispositivo
        </Link>
      </p>
    </div>
  );
}
