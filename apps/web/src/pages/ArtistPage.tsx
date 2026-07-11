/**
 * /artist/:id — banner hero (bannerUrl or ambient glow), verified badge,
 * top tracks (5 → 10), discography carousels by type and related artists.
 */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { motion } from 'framer-motion';
import { BadgeCheck, MicVocal, Shuffle, UserMinus, UserPlus } from 'lucide-react';
import type { AlbumDto } from '@aurial/shared';
import { ArtistCard } from '@/components/media/ArtistCard';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import {
  useArtist,
  useArtistAlbums,
  useArtistTopTracks,
  useFollowArtist,
  useRelatedArtists,
} from '@/features/artists/api';
import { useTrackLikes } from '@/features/library/api';
import { useDominantColor } from '@/hooks/useDominantColor';
import { cn, formatCompactNumber } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function AlbumCarousel({ title, albums }: { title: string; albums: AlbumDto[] }) {
  if (albums.length === 0) return null;
  return (
    <SectionCarousel title={title}>
      {albums.map((album) => (
        <MediaCard
          key={album.id}
          title={album.title}
          subtitle={
            album.releaseDate ? String(new Date(album.releaseDate).getFullYear()) : undefined
          }
          imageUrl={album.coverUrl}
          to={`/album/${album.id}`}
        />
      ))}
    </SectionCarousel>
  );
}

export default function ArtistPage() {
  const { id = '' } = useParams<{ id: string }>();
  const artist = useArtist(id);
  const topTracks = useArtistTopTracks(id);
  const albums = useArtistAlbums(id);
  const related = useRelatedArtists(id);
  const follow = useFollowArtist(id);
  const likes = useTrackLikes();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [showAllTop, setShowAllTop] = useState(false);
  const glow = useDominantColor(artist.data?.bannerUrl ? null : artist.data?.imageUrl);

  const byType = useMemo(() => {
    const list = albums.data ?? [];
    return {
      albums: list.filter((a) => a.type === 'ALBUM' || a.type === 'COMPILATION'),
      singles: list.filter((a) => a.type === 'SINGLE'),
      eps: list.filter((a) => a.type === 'EP'),
    };
  }, [albums.data]);

  if (artist.isLoading) return <PageSkeleton variant="detail" />;
  if (artist.isError || !artist.data) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void artist.refetch()} />
      </div>
    );
  }

  const info = artist.data;
  const following = info.isFollowing ?? false;
  const tracks = topTracks.data ?? [];
  const visibleTracks = showAllTop ? tracks.slice(0, 10) : tracks.slice(0, 5);

  const playAll = (index = 0): void => {
    if (tracks.length === 0) return;
    playQueue(tracks, index, { source: 'artist', sourceId: info.id });
  };

  const playShuffled = (): void => {
    if (tracks.length === 0) return;
    if (!shuffle) toggleShuffle();
    playQueue(tracks, Math.floor(Math.random() * tracks.length), {
      source: 'artist',
      sourceId: info.id,
    });
  };

  return (
    <div className="space-y-8 py-4">
      {/* Banner hero */}
      <header className="relative -mx-4 md:-mx-6 lg:-mx-8">
        <div className="relative h-56 overflow-hidden md:h-72">
          {info.bannerUrl ? (
            <>
              <img src={info.bannerUrl} alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
            </>
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 opacity-25 blur-[120px]"
              style={{
                background: `radial-gradient(60% 80% at 30% 20%, ${glow ?? 'hsl(var(--accent))'} 0%, transparent 70%)`,
              }}
            />
          )}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="relative -mt-24 flex flex-col items-center gap-5 px-4 md:-mt-28 md:flex-row md:items-end md:px-6 lg:px-8"
        >
          <div className="size-36 shrink-0 overflow-hidden rounded-full border-4 border-bg bg-fg/6 shadow-xl md:size-44">
            {info.imageUrl ? (
              <img src={info.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-fg-subtle">
                <MicVocal className="size-10" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2 pb-1 text-center md:items-start md:text-left">
            {info.verified && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-info">
                <BadgeCheck className="size-4" /> Artista verificado
              </span>
            )}
            <h1 className="line-clamp-2 text-4xl font-bold tracking-tight text-fg md:text-5xl">
              {info.name}
            </h1>
            <p className="text-[13px] text-fg-muted">
              {formatCompactNumber(info.monthlyListeners)} ouvintes mensais
              {info.genres.length > 0 && <> · {info.genres.slice(0, 3).join(', ')}</>}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <PlayButton size="lg" onClick={() => playAll(0)} disabled={tracks.length === 0} />
              <Button
                variant="outline"
                size="sm"
                onClick={playShuffled}
                disabled={tracks.length === 0}
              >
                <Shuffle /> Aleatório
              </Button>
              <Button
                variant={following ? 'default' : 'outline'}
                size="sm"
                aria-pressed={following}
                onClick={() => follow.mutate(!following)}
                className={cn(following && 'text-accent')}
              >
                {following ? <UserMinus /> : <UserPlus />}
                {following ? 'Seguindo' : 'Seguir'}
              </Button>
            </div>
          </div>
        </motion.div>
      </header>

      {/* Top tracks */}
      <section aria-label="Populares">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Populares</h2>
        {topTracks.isError && <ErrorState onRetry={() => void topTracks.refetch()} />}
        {topTracks.data && tracks.length === 0 && (
          <EmptyState icon={MicVocal} title="Sem faixas por enquanto" />
        )}
        <TrackList>
          {visibleTracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              showAlbum
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              liked={likes.isLiked(track)}
              onToggleLike={(liked) => likes.toggle(track, liked)}
              onPlay={() => playAll(index)}
            />
          ))}
        </TrackList>
        {tracks.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAllTop((v) => !v)}
            className="mt-2 px-2 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {showAllTop ? 'Mostrar menos' : 'Mostrar mais'}
          </button>
        )}
      </section>

      <AlbumCarousel title="Álbuns" albums={byType.albums} />
      <AlbumCarousel title="Singles" albums={byType.singles} />
      <AlbumCarousel title="EPs" albums={byType.eps} />

      {related.data && related.data.length > 0 && (
        <SectionCarousel title="Artistas parecidos">
          {related.data.map((relatedArtist) => (
            <ArtistCard key={relatedArtist.id} artist={relatedArtist} />
          ))}
        </SectionCarousel>
      )}

      {info.bio && (
        <section aria-label="Sobre" className="max-w-3xl">
          <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Sobre</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{info.bio}</p>
        </section>
      )}
    </div>
  );
}
