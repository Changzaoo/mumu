/**
 * /album-apple/:id — an artist's album from iTunes (the reliable source). Lists
 * the album's real tracklist; tracks you already have play, the rest are shown
 * for reference (marked as not in your library).
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Disc3, Music, Pause, Play } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { useAppleAlbumTracks } from '@/features/catalog/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { cn, formatDuration, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function AppleAlbumPage() {
  const { id = '' } = useParams<{ id: string }>();
  const collectionId = Number(id);
  const q = useAppleAlbumTracks(collectionId);
  // Re-render as ownership changes (imports finishing, etc.).
  useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);

  const tracks = q.data ?? [];
  const header = tracks[0];

  // Map each album track to the local copy you own (if any).
  const owned = useMemo(
    () => tracks.map((t) => localLibrary.findOwnedTrack(t.title, t.artists[0]?.name)),
    [tracks],
  );
  const ownedList = owned.filter((t): t is TrackDto => t !== null);

  const playOwned = (fromTrackId?: string): void => {
    if (ownedList.length === 0) return;
    const start = fromTrackId ? ownedList.findIndex((t) => t.id === fromTrackId) : 0;
    playQueue(ownedList, Math.max(0, start), { source: 'library', sourceId: `album:${id}` });
  };

  if (q.isLoading) return <PageSkeleton variant="detail" />;
  if (q.isError) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void q.refetch()} />
      </div>
    );
  }
  if (!header) {
    return (
      <div className="py-16">
        <EmptyState icon={Disc3} title="Álbum não encontrado" description="Tente outro álbum." />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <span className="size-40 shrink-0 overflow-hidden rounded-lg bg-fg/6 shadow-xl">
          {header.coverUrl ? (
            <img src={header.coverUrl} alt="" className="size-full object-cover" />
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
          <h1 className="mt-1 line-clamp-2 text-3xl font-bold tracking-tight text-fg md:text-4xl">
            {header.album?.title ?? 'Álbum'}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            {header.artists[0]?.name && (
              <Link
                to={`/artista/${encodeURIComponent(header.artists[0].name)}`}
                className="hover:text-fg hover:underline"
              >
                {header.artists[0].name}
              </Link>
            )}{' '}
            · {tracks.length} faixas · {ownedList.length} na sua biblioteca
          </p>
          {ownedList.length > 0 && (
            <button
              type="button"
              onClick={() => playOwned()}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
            >
              <Play className="size-4 fill-current" /> Tocar o que tenho
            </button>
          )}
        </div>
      </header>

      <ol className="space-y-0.5">
        {tracks.map((track, index) => {
          const mine = owned[index];
          const active = mine && mine.id === currentTrack?.id;
          return (
            <li
              key={track.id}
              className={cn(
                'grid h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2',
                mine ? 'hover:bg-fg/5' : 'opacity-55',
              )}
            >
              {mine ? (
                <button
                  type="button"
                  aria-label={active && isPlaying ? 'Pausar' : `Reproduzir ${track.title}`}
                  onClick={() => (active ? toggle() : playOwned(mine.id))}
                  className="grid size-7 place-items-center justify-self-center rounded-full text-fg hover:text-accent"
                >
                  {active && isPlaying ? (
                    <Pause className="size-4 fill-current text-accent" />
                  ) : (
                    <Play className="ml-0.5 size-4 fill-current" />
                  )}
                </button>
              ) : (
                <span className="justify-self-center text-[13px] tabular-nums text-fg-subtle">
                  {index + 1}
                </span>
              )}
              <div className="min-w-0">
                <p className={cn('line-clamp-1 text-sm', active ? 'text-accent' : 'text-fg')}>
                  {track.title}
                </p>
                <p className="line-clamp-1 text-[12px] text-fg-muted">
                  {mine ? trackArtistNames(track) : 'Não está na sua biblioteca'}
                </p>
              </div>
              <span className="flex items-center gap-2 text-[12px] tabular-nums text-fg-muted">
                {!mine && <Music className="size-3.5 text-fg-subtle" />}
                {track.durationMs > 0 ? formatDuration(track.durationMs) : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
