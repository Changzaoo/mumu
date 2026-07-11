/**
 * /catalogo/playlist/:id — a trending Audius playlist: hero + track list, all
 * directly playable through the shared engine.
 */
import { Link, useParams } from 'react-router';
import { ArrowLeft, ListMusic, Play } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import { useCatalogPlaylist, usePlaylistTracks } from '@/features/catalog/api';
import { usePlayerStore } from '@/stores/playerStore';

export default function CatalogPlaylistPage() {
  const { id = '' } = useParams();
  const meta = useCatalogPlaylist(id);
  const tracksQuery = usePlaylistTracks(id);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  if (tracksQuery.isLoading) return <PageSkeleton variant="detail" />;
  if (tracksQuery.isError) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void tracksQuery.refetch()} />
      </div>
    );
  }

  const tracks = tracksQuery.data ?? [];
  const cover = meta.data?.coverUrl ?? tracks[0]?.coverUrl ?? null;

  return (
    <div className="space-y-6 py-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Início
      </Link>

      <HeroHeader
        type="Playlist"
        title={meta.data?.title ?? 'Playlist'}
        imageUrl={cover}
        meta={
          <>
            {meta.data?.userName && <span>{meta.data.userName}</span>}
            {tracks.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}
                </span>
              </>
            )}
          </>
        }
        actions={
          <Button
            variant="accent"
            disabled={tracks.length === 0}
            onClick={() =>
              tracks.length > 0 && playQueue(tracks, 0, { source: 'playlist', sourceId: id })
            }
          >
            <Play className="fill-current" /> Tocar
          </Button>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState icon={ListMusic} title="Playlist vazia" description="Nada para tocar aqui." />
      ) : (
        <TrackList aria-label="Faixas da playlist">
          {tracks.map((track, index) => (
            <TrackRow
              key={`${track.id}:${index}`}
              track={track}
              index={index}
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              onPlay={() => playQueue(tracks, index, { source: 'playlist', sourceId: id })}
            />
          ))}
        </TrackList>
      )}
    </div>
  );
}
