/**
 * / — Home, Spotify-shaped. Everything here is REAL, full-length playable music
 * (no 30s previews): the tracks people add to the app, your own device library,
 * and the Audius public catalog of independent artists (plays in full, can be
 * downloaded/offline). Organized into clean rows and per-genre carousels.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { Clock, HardDriveDownload, Heart, Library, Play } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { CommunityTracksRow } from '@/components/media/CommunityTracksRow';
import { DeviceTracksRow } from '@/components/media/DeviceTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { CATALOG_GENRES } from '@/lib/catalog/audius';
import { useTrending, useTrendingPlaylists } from '@/features/catalog/api';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Genres shown as their own home rows (Spotify-style density). */
const HOME_GENRE_ROWS = ['Hip-Hop/Rap', 'Pop', 'Electronic', 'Rock', 'R&B/Soul', 'Lo-Fi'] as const;

/** Chips offered on the home genre filter. */
const GENRE_CHIPS = CATALOG_GENRES.slice(0, 10);

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Spotify-style quick-access shortcut tiles to the user's own spaces. */
function QuickAccess() {
  const items = [
    { to: '/liked', label: 'Curtidas', icon: Heart },
    { to: '/history', label: 'Histórico', icon: Clock },
    { to: '/library', label: 'Biblioteca', icon: Library },
    { to: '/dispositivo', label: 'No dispositivo', icon: HardDriveDownload },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 px-3 lg:grid-cols-4">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="glass group flex items-center gap-3 overflow-hidden rounded-lg py-2 pr-3 transition-colors duration-200 hover:bg-fg/10"
        >
          <span className="grid size-11 shrink-0 place-items-center bg-accent/12 text-accent">
            <Icon className="size-5" />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-fg">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** One per-genre carousel (Audius full tracks) — each owns its query. */
function GenreRow({ genre }: { genre: string }) {
  const q = useTrending(genre);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const tracks = q.data ?? [];

  if (q.isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="px-3 text-xl font-semibold tracking-tight text-fg">{genre}</h2>
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-hidden px-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="w-40 shrink-0 p-3 md:w-44">
              <div className="aspect-square animate-pulse rounded-lg bg-fg/6" />
              <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-fg/6" />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (tracks.length === 0) return null;

  return (
    <SectionCarousel title={genre}>
      {tracks.map((track, index) => (
        <MediaCard
          key={track.id}
          title={track.title}
          subtitle={trackArtistNames(track)}
          imageUrl={track.coverUrl}
          playing={currentTrack?.id === track.id && isPlaying}
          onPlay={() => playQueue(tracks, index, { source: 'home' })}
        />
      ))}
    </SectionCarousel>
  );
}

export default function HomePage() {
  // null = all genres; otherwise an Audius genre label.
  const [genre, setGenre] = useState<string | null>(null);

  const top = useTrending(genre ?? undefined);
  const playlists = useTrendingPlaylists();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracks: TrackDto[] = top.data ?? [];

  return (
    <div className="space-y-8 py-4">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl"
      >
        {localGreeting()}
      </motion.h1>

      {genre === null && <QuickAccess />}

      {/* Recently added to the app + your own device tracks. */}
      {genre === null && <CommunityTracksRow limit={20} />}
      {genre === null && <DeviceTracksRow limit={12} />}

      {/* Genre filter chips (Audius). */}
      <div
        role="tablist"
        aria-label="Filtrar por gênero"
        className="no-scrollbar flex gap-2 overflow-x-auto px-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={genre === null}
          onClick={() => setGenre(null)}
          className={cn(
            'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
            genre === null ? 'bg-fg text-bg' : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
          )}
        >
          Tudo
        </button>
        {GENRE_CHIPS.map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={genre === g}
            onClick={() => setGenre(g)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
              genre === g ? 'bg-fg text-bg' : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
            )}
          >
            {g}
          </button>
        ))}
      </div>

      {top.isLoading && <PageSkeleton variant="home" />}
      {top.isError && (
        <div className="px-3">
          <ErrorState onRetry={() => void top.refetch()} />
        </div>
      )}

      {top.data && (
        <>
          {tracks.length > 0 ? (
            <section className={cn(top.isFetching && 'opacity-70 transition-opacity')}>
              <div className="mb-3 flex items-center justify-between px-3">
                <h2 className="text-xl font-semibold tracking-tight text-fg">
                  {genre ? `Em alta · ${genre}` : 'Em alta'}
                </h2>
                <button
                  type="button"
                  onClick={() => playQueue(tracks, 0, { source: 'home' })}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                >
                  <Play className="size-3.5 fill-current" /> Tocar tudo
                </button>
              </div>
              <div
                aria-label="Faixas em alta"
                className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto px-2 pb-1"
              >
                {tracks.map((track, index) => (
                  <MediaCard
                    key={track.id}
                    title={track.title}
                    subtitle={trackArtistNames(track)}
                    imageUrl={track.coverUrl}
                    playing={currentTrack?.id === track.id && isPlaying}
                    onPlay={() => playQueue(tracks, index, { source: 'home' })}
                  />
                ))}
              </div>
            </section>
          ) : (
            <EmptyState
              icon={Play}
              title="Nada em alta por aqui"
              description="Tente outro gênero ou volte mais tarde."
            />
          )}
        </>
      )}

      {/* Per-genre rows — only on the "Tudo" view, to keep the page alive. */}
      {genre === null && HOME_GENRE_ROWS.map((g) => <GenreRow key={g} genre={g} />)}

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
