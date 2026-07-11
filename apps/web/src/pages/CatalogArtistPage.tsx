/**
 * /catalogo/artista/:id — an Audius artist's tracks: hero + track list.
 */
import { Link, useParams } from 'react-router';
import { ArrowLeft, MicVocal, Play } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import { useArtistTracks } from '@/features/catalog/api';
import { usePlayerStore } from '@/stores/playerStore';

export default function CatalogArtistPage() {
  const { id = '' } = useParams();
  const tracksQuery = useArtistTracks(id);

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
  const artist = tracks[0]?.artists[0];

  return (
    <div className="space-y-6 py-4">
      <Link
        to="/search"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Buscar
      </Link>

      <HeroHeader
        type="Artista"
        title={artist?.name ?? 'Artista'}
        imageUrl={artist?.imageUrl ?? tracks[0]?.coverUrl ?? null}
        round
        meta={
          tracks.length > 0 ? (
            <span>
              {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}
            </span>
          ) : undefined
        }
        actions={
          <Button
            variant="accent"
            disabled={tracks.length === 0}
            onClick={() =>
              tracks.length > 0 && playQueue(tracks, 0, { source: 'artist', sourceId: id })
            }
          >
            <Play className="fill-current" /> Tocar
          </Button>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState
          icon={MicVocal}
          title="Sem faixas públicas"
          description="Este artista ainda não publicou faixas no catálogo."
        />
      ) : (
        <TrackList aria-label="Faixas do artista">
          {tracks.map((track, index) => (
            <TrackRow
              key={`${track.id}:${index}`}
              track={track}
              index={index}
              showAlbum={false}
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              onPlay={() => playQueue(tracks, index, { source: 'artist', sourceId: id })}
            />
          ))}
        </TrackList>
      )}
    </div>
  );
}
