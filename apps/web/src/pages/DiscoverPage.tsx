/**
 * /discover — browse by genre. The grid uses the Audius genres; picking one
 * (?g={genre}) shows that genre's full-length free tracks (playable in full,
 * downloadable). No 30s previews.
 */
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Compass, Play, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CATALOG_GENRES } from '@/lib/catalog/audius';
import { useTrending, useTrendingPlaylists } from '@/features/catalog/api';
import { usePlayerStore } from '@/stores/playerStore';

/** A stable-ish hue per genre for the tinted tiles. */
function hueFor(genre: string): number {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) hash = (hash * 31 + genre.charCodeAt(i)) % 360;
  return hash;
}

function GenreGrid() {
  return (
    <section aria-label="Gêneros">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Explorar por gênero</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CATALOG_GENRES.map((genre, index) => {
          const hue = hueFor(genre);
          return (
            <motion.div
              key={genre}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.2 }}
            >
              <Link
                to={`/discover?g=${encodeURIComponent(genre)}`}
                className="group relative block overflow-hidden rounded-xl border border-border bg-bg-elevated p-4 pt-12 transition-transform duration-200 hover:scale-[1.02] focus-visible:scale-[1.02]"
                style={{
                  backgroundImage: `linear-gradient(135deg, hsl(${hue} 80% 50% / 0.28) 0%, hsl(${(hue + 40) % 360} 80% 45% / 0.10) 100%)`,
                }}
              >
                <span className="text-base font-semibold tracking-tight text-fg">{genre}</span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-4 -top-4 size-16 rounded-full opacity-40 blur-2xl transition-opacity duration-200 group-hover:opacity-70"
                  style={{ background: `hsl(${hue} 80% 55%)` }}
                />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function GenreView({ label }: { label: string }) {
  const free = useTrending(label);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hue = hueFor(label);
  const tracks = free.data ?? [];

  return (
    <div className="space-y-8 py-4">
      <header className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-16 -top-32 h-80 opacity-25 blur-[120px]"
          style={{
            background: `radial-gradient(60% 60% at 35% 30%, hsl(${hue} 80% 50%) 0%, transparent 70%)`,
          }}
        />
        <div className="relative space-y-4">
          <Link
            to="/discover"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-4" /> Descobrir
          </Link>
          <h1 className="text-4xl font-bold tracking-tight text-fg md:text-5xl">{label}</h1>
          <Button
            variant="accent"
            onClick={() =>
              tracks.length > 0 &&
              playQueue(tracks, 0, { source: 'recommendation', sourceId: `genre:${label}` })
            }
            disabled={tracks.length === 0}
          >
            <Play className="fill-current" /> Tocar tudo
          </Button>
        </div>
      </header>

      {free.isLoading && <PageSkeleton variant="list" />}
      {free.isError && <ErrorState onRetry={() => void free.refetch()} />}
      {free.data && tracks.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="Nada neste gênero ainda"
          description="Tente outro gênero — o catálogo muda o tempo todo."
        />
      )}
      {tracks.length > 0 && (
        <section aria-label={`Em alta · ${label}`} className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight text-fg">Em alta</h2>
          <TrackList className={free.isFetching ? 'opacity-70' : ''}>
            {tracks.map((track, index) => (
              <TrackRow
                key={`${track.id}:${index}`}
                track={track}
                index={index}
                showAlbum={false}
                active={track.id === currentTrack?.id}
                playing={track.id === currentTrack?.id && isPlaying}
                onPlay={() =>
                  playQueue(tracks, index, { source: 'recommendation', sourceId: `genre:${label}` })
                }
              />
            ))}
          </TrackList>
        </section>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  const [searchParams] = useSearchParams();
  const genreParam = searchParams.get('g');
  const genre = CATALOG_GENRES.find((g) => g === genreParam) ?? null;

  const playlists = useTrendingPlaylists();

  if (genre) return <GenreView label={genre} />;

  return (
    <div className="space-y-8 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <Compass className="size-7 text-fg-muted" /> Descobrir
      </h1>

      <GenreGrid />

      {playlists.isLoading && (
        <div className="no-scrollbar flex gap-1 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="w-40 shrink-0 p-3 md:w-44">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}
      {playlists.isError && <ErrorState onRetry={() => void playlists.refetch()} />}
      {playlists.data && playlists.data.length > 0 && (
        <SectionCarousel title="Playlists em alta">
          {playlists.data.map((playlist) => (
            <MediaCard
              key={playlist.id}
              title={playlist.title}
              subtitle={playlist.userName}
              imageUrl={playlist.coverUrl}
              to={`/catalogo/playlist/${playlist.id}`}
            />
          ))}
        </SectionCarousel>
      )}
    </div>
  );
}
