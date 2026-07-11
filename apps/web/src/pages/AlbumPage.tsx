/**
 * /album/:id — hero, disc-grouped track list, total duration, like album.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Disc3 } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { LikeButton } from '@/components/media/LikeButton';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useAlbum } from '@/features/albums/api';
import { useToggleLikeAlbum, useTrackLikes } from '@/features/library/api';
import { formatDurationLong } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const TYPE_LABEL: Record<string, string> = {
  ALBUM: 'Álbum',
  SINGLE: 'Single',
  EP: 'EP',
  COMPILATION: 'Coletânea',
};

export default function AlbumPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useAlbum(id);
  const likes = useTrackLikes();
  const toggleLikeAlbum = useToggleLikeAlbum();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [albumLiked, setAlbumLiked] = useState(false);
  useEffect(() => {
    if (data?.isLiked !== undefined) setAlbumLiked(data.isLiked);
  }, [data?.isLiked]);

  const discs = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, TrackDto[]>();
    for (const track of data.tracks) {
      const disc = track.discNumber ?? 1;
      const list = map.get(disc);
      if (list) list.push(track);
      else map.set(disc, [track]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [data]);

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (isError || !data) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  const releaseYear = data.releaseDate ? new Date(data.releaseDate).getFullYear() : null;
  const multiDisc = discs.length > 1;
  const albumPlaying = data.tracks.some((t) => t.id === currentTrack?.id) && isPlaying;

  const playAll = (index = 0): void => {
    playQueue(data.tracks, index, { source: 'album', sourceId: data.id });
  };

  return (
    <div className="space-y-6 py-4">
      <HeroHeader
        type={TYPE_LABEL[data.type] ?? 'Álbum'}
        title={data.title}
        imageUrl={data.coverUrl}
        dominantColor={data.dominantColor}
        meta={
          <>
            {data.artists.map((artist, i) => (
              <Fragment key={artist.id}>
                {i > 0 && <span aria-hidden>·</span>}
                <Link to={`/artist/${artist.id}`} className="font-medium text-fg hover:underline">
                  {artist.name}
                </Link>
              </Fragment>
            ))}
            {releaseYear && (
              <>
                <span aria-hidden>·</span>
                <span>{releaseYear}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{data.trackCount} faixas</span>
            <span aria-hidden>·</span>
            <span>{formatDurationLong(data.durationMs)}</span>
          </>
        }
        actions={
          <>
            <PlayButton
              size="lg"
              playing={albumPlaying}
              onClick={() => {
                if (albumPlaying) usePlayerStore.getState().toggle();
                else playAll(0);
              }}
              disabled={data.tracks.length === 0}
            />
            <LikeButton
              liked={albumLiked}
              size="md"
              onToggle={(liked) => {
                setAlbumLiked(liked);
                toggleLikeAlbum.mutate(
                  { album: data, liked },
                  { onError: () => setAlbumLiked(!liked) },
                );
              }}
              aria-label={albumLiked ? 'Remover álbum da biblioteca' : 'Salvar álbum na biblioteca'}
            />
          </>
        }
      />

      {discs.map(([discNumber, tracks]) => (
        <section key={discNumber} aria-label={multiDisc ? `Disco ${discNumber}` : 'Faixas'}>
          {multiDisc && (
            <h2 className="mb-2 flex items-center gap-2 px-2 text-lg font-semibold tracking-tight text-fg">
              <Disc3 className="size-4 text-fg-muted" /> Disco {discNumber}
            </h2>
          )}
          <TrackList>
            {tracks.map((track) => {
              const queueIndex = data.tracks.indexOf(track);
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={(track.trackNumber ?? queueIndex + 1) - 1}
                  showAlbum={false}
                  showArt={false}
                  active={track.id === currentTrack?.id}
                  playing={track.id === currentTrack?.id && isPlaying}
                  liked={likes.isLiked(track)}
                  onToggleLike={(liked) => likes.toggle(track, liked)}
                  onPlay={() => playAll(queueIndex)}
                />
              );
            })}
          </TrackList>
        </section>
      ))}

      {data.genres.length > 0 && (
        <p className="text-[13px] text-fg-subtle">{data.genres.join(' · ')}</p>
      )}
    </div>
  );
}
