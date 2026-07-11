/**
 * /discover — mood grid (→ /discover?mood=x → GET /recs/mood/:mood),
 * new releases and trending.
 */
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Compass, Play, Sparkles } from 'lucide-react';
import { MOODS, type Mood } from '@aurial/shared';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { useMoodTracks, useNewReleases, useTrending } from '@/features/browse/api';
import { useTrackLikes } from '@/features/library/api';
import { usePlayerStore } from '@/stores/playerStore';
import { trackArtistNames } from '@/lib/utils';
import { radioToTrack } from '@/features/browse/api';
import { ArtistCard } from '@/components/media/ArtistCard';
import { PlaylistCard } from '@/components/media/PlaylistCard';
import type { HomeSectionItem } from '@aurial/shared';

/** pt-BR labels + hue pairs for the tinted mood tiles (ambient, low-opacity). */
const MOOD_META: Record<Mood, { label: string; hue: number }> = {
  chill: { label: 'Relaxar', hue: 190 },
  focus: { label: 'Foco', hue: 220 },
  workout: { label: 'Treino', hue: 10 },
  gaming: { label: 'Games', hue: 270 },
  lofi: { label: 'Lo-fi', hue: 30 },
  party: { label: 'Festa', hue: 320 },
  sleep: { label: 'Dormir', hue: 240 },
  romance: { label: 'Romance', hue: 350 },
  sad: { label: 'Melancolia', hue: 210 },
  happy: { label: 'Alegria', hue: 45 },
};

function MoodGrid() {
  return (
    <section aria-label="Moods">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Como você está hoje?</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {MOODS.map((mood, index) => {
          const meta = MOOD_META[mood];
          return (
            <motion.div
              key={mood}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.2 }}
            >
              <Link
                to={`/discover?mood=${mood}`}
                className="group relative block overflow-hidden rounded-xl border border-border bg-bg-elevated p-4 pt-12 transition-transform duration-200 hover:scale-[1.02] focus-visible:scale-[1.02]"
                style={{
                  backgroundImage: `linear-gradient(135deg, hsl(${meta.hue} 80% 50% / 0.28) 0%, hsl(${(meta.hue + 40) % 360} 80% 45% / 0.10) 100%)`,
                }}
              >
                <span className="text-base font-semibold tracking-tight text-fg">{meta.label}</span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-4 -top-4 size-16 rounded-full opacity-40 blur-2xl transition-opacity duration-200 group-hover:opacity-70"
                  style={{ background: `hsl(${meta.hue} 80% 55%)` }}
                />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function TrendingItem({ item }: { item: HomeSectionItem }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  switch (item.kind) {
    case 'track':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={trackArtistNames(item.item)}
          imageUrl={item.item.coverUrl}
          to={item.item.album ? `/album/${item.item.album.id}` : undefined}
          onPlay={() => playTrack(item.item, { source: 'recommendation', sourceId: 'trending' })}
        />
      );
    case 'album':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={item.item.artists.map((a) => a.name).join(', ')}
          imageUrl={item.item.coverUrl}
          to={`/album/${item.item.id}`}
        />
      );
    case 'artist':
      return <ArtistCard artist={item.item} />;
    case 'playlist':
      return <PlaylistCard playlist={item.item} />;
    case 'podcast':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={item.item.publisher}
          imageUrl={item.item.coverUrl}
          to={`/podcast/${item.item.id}`}
        />
      );
    case 'radio':
      return (
        <MediaCard
          title={item.item.name}
          subtitle="Rádio ao vivo"
          imageUrl={item.item.imageUrl}
          to="/radios"
          onPlay={() =>
            playTrack(radioToTrack(item.item), { source: 'radio', sourceId: item.item.id })
          }
        />
      );
  }
}

/** ?mood=x view — tracks for the selected mood. */
function MoodView({ mood }: { mood: Mood }) {
  const { data, isLoading, isError, refetch } = useMoodTracks(mood);
  const likes = useTrackLikes();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const meta = MOOD_META[mood];

  return (
    <div className="space-y-6 py-4">
      <header className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-16 -top-32 h-80 opacity-25 blur-[120px]"
          style={{
            background: `radial-gradient(60% 60% at 35% 30%, hsl(${meta.hue} 80% 50%) 0%, transparent 70%)`,
          }}
        />
        <div className="relative space-y-4">
          <Link
            to="/discover"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-4" /> Descobrir
          </Link>
          <h1 className="text-4xl font-bold tracking-tight text-fg md:text-5xl">{meta.label}</h1>
          <Button
            variant="accent"
            onClick={() =>
              data &&
              data.length > 0 &&
              playQueue(data, 0, { source: 'recommendation', sourceId: `mood:${mood}` })
            }
            disabled={!data || data.length === 0}
          >
            <Play className="fill-current" /> Tocar tudo
          </Button>
        </div>
      </header>

      {isLoading && <PageSkeleton variant="list" />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="Nada para este mood ainda"
          description="Volte em breve — as recomendações são atualizadas todo dia."
        />
      )}
      {data && data.length > 0 && (
        <TrackList aria-label={`Faixas para ${meta.label}`}>
          {data.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              liked={likes.isLiked(track)}
              onToggleLike={(liked) => likes.toggle(track, liked)}
              onPlay={() =>
                playQueue(data, index, { source: 'recommendation', sourceId: `mood:${mood}` })
              }
            />
          ))}
        </TrackList>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  const [searchParams] = useSearchParams();
  const moodParam = searchParams.get('mood');
  const mood = (MOODS as readonly string[]).includes(moodParam ?? '') ? (moodParam as Mood) : null;

  const newReleases = useNewReleases();
  const trending = useTrending();

  if (mood) return <MoodView mood={mood} />;

  return (
    <div className="space-y-8 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <Compass className="size-7 text-fg-muted" /> Descobrir
      </h1>

      <MoodGrid />

      {newReleases.isLoading && (
        <div className="no-scrollbar flex gap-1 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="w-40 shrink-0 p-3 md:w-44">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}
      {newReleases.isError && <ErrorState onRetry={() => void newReleases.refetch()} />}
      {newReleases.data && newReleases.data.length > 0 && (
        <SectionCarousel title="Lançamentos" subtitle="Álbuns e singles recém-chegados">
          {newReleases.data.map((album) => (
            <MediaCard
              key={album.id}
              title={album.title}
              subtitle={album.artists.map((a) => a.name).join(', ')}
              imageUrl={album.coverUrl}
              to={`/album/${album.id}`}
            />
          ))}
        </SectionCarousel>
      )}

      {trending.data && trending.data.items.length > 0 && (
        <SectionCarousel title={trending.data.title} subtitle={trending.data.subtitle ?? undefined}>
          {trending.data.items.map((item) => (
            <TrendingItem key={`${item.kind}:${item.item.id}`} item={item} />
          ))}
        </SectionCarousel>
      )}
    </div>
  );
}
