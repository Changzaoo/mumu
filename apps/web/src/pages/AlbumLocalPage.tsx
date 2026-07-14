/**
 * /disco/:key — an album from YOUR library: its tracks, grouped from local
 * metadata. `key` is localLibrary's album key (normalised title|artist).
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Disc3, Play, Share2 } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { openShare } from '@/components/media/ShareDialog';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { tracksToShare } from '@/lib/share/share';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function AlbumLocalPage() {
  const { key = '' } = useParams<{ key: string }>();
  const albumKey = decodeURIComponent(key);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const album = useMemo(() => localLibrary.albumByKey(albumKey), [entries, albumKey]);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  if (!album) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Disc3}
          title="Álbum não encontrado"
          description="Ele não está no aparelho."
        />
      </div>
    );
  }

  const tracks = album.tracks;
  const play = (index = 0): void =>
    playQueue(tracks, index, { source: 'album', sourceId: album.key });

  return (
    <div className="space-y-8 py-4">
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <span className="size-40 shrink-0 overflow-hidden rounded-xl bg-fg/6 shadow-xl">
          {album.coverUrl ? (
            <img src={album.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-fg-subtle">
              <Disc3 className="size-12" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            Álbum
          </p>
          <h1 className="mt-1 line-clamp-2 text-4xl font-bold tracking-tight text-fg">
            {album.title}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            <Link to={`/artista/${encodeURIComponent(album.artist)}`} className="hover:text-fg">
              {album.artist}
            </Link>{' '}
            · {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => play(0)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
            >
              <Play className="size-4 fill-current" /> Tocar
            </button>
            <button
              type="button"
              aria-label="Compartilhar álbum"
              onClick={() =>
                openShare({
                  type: 'álbum',
                  title: album.title,
                  subtitle: album.artist,
                  coverUrl: album.coverUrl,
                  tracks: tracksToShare(tracks),
                })
              }
              className="grid size-10 place-items-center rounded-full border border-border text-fg transition-colors hover:bg-fg/5"
            >
              <Share2 className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <TrackList header aria-label={`Faixas de ${album.title}`}>
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
