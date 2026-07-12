/**
 * / — Catalog home, Spotify-shaped. Two data sources, clearly separated:
 *
 *  1. PRIMARY "Em alta" — the real mainstream hits from the Apple/iTunes charts
 *     (Drake, The Weeknd, Shakira…). These play as legal **30-second previews**
 *     (stream-only, never downloadable). Genre chips switch the chart, and a set
 *     of per-genre rows fill the page with covers.
 *  2. SECONDARY "Grátis e completas" — the Audius public catalog: independent
 *     artists whose tracks play in **full length** and can be downloaded/offline.
 *
 * The central Aurial backend is not deployed in the P2P topology, so both feeds
 * are read directly from their public APIs on the client.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { HardDriveDownload, Music, Play, Share2 } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { CommunityTracksRow } from '@/components/media/CommunityTracksRow';
import { DeviceTracksRow } from '@/components/media/DeviceTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { APPLE_GENRES } from '@/lib/catalog/itunes';
import {
  useTopSongs,
  useTopSongsByGenre,
  useTrending,
  useTrendingPlaylists,
} from '@/features/catalog/api';
import { useCommunityTrending } from '@/features/trending/api';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Genres shown as their own home rows (Spotify-style density). */
const HOME_GENRE_ROWS = [1332, 1123, 14, 18, 7, 21] as const;

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Compact 2-col grid of the top hits — the home "jump back in" tiles. */
function QuickTiles({ tracks, onPlay }: { tracks: TrackDto[]; onPlay: (index: number) => void }) {
  if (tracks.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 px-3 sm:grid-cols-2 lg:grid-cols-3">
      {tracks.slice(0, 6).map((track, index) => (
        <button
          key={track.id}
          type="button"
          onClick={() => onPlay(index)}
          className="glass group flex items-center gap-3 overflow-hidden rounded-lg pr-3 text-left transition-colors duration-200 hover:bg-fg/10"
        >
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden bg-fg/6 text-fg-subtle">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <Music className="size-5" />
            )}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-fg">
            {track.title}
          </span>
          <span className="grid size-8 shrink-0 translate-x-1 place-items-center rounded-full bg-accent text-bg opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            <Play className="size-4 fill-current" />
          </span>
        </button>
      ))}
    </div>
  );
}

/** One per-genre carousel — each owns its query so rows load independently. */
function GenreRow({ genreId, label }: { genreId: number; label: string }) {
  const q = useTopSongsByGenre(genreId, 'br');
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const tracks = q.data ?? [];

  if (q.isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="px-3 text-xl font-semibold tracking-tight text-fg">{label}</h2>
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
    <SectionCarousel title={label} subtitle="Em alta no gênero">
      {tracks.map((track, index) => (
        <MediaCard
          key={track.id}
          title={track.title}
          subtitle={trackArtistNames(track)}
          imageUrl={track.coverUrl}
          previewOnly={track.previewOnly}
          playing={currentTrack?.id === track.id && isPlaying}
          onPlay={() => playQueue(tracks, index, { source: 'home' })}
        />
      ))}
    </SectionCarousel>
  );
}

function DeviceShortcut() {
  return (
    <section aria-label="No seu dispositivo" className="px-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/dispositivo"
          className="glass group flex items-center gap-4 rounded-xl p-4 transition-colors duration-200 hover:bg-fg/5"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
            <HardDriveDownload className="size-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">No seu dispositivo</span>
            <span className="block text-[13px] text-fg-muted">
              Importe seus arquivos e ouça offline
            </span>
          </span>
        </Link>
        <Link
          to="/compartilhar"
          className="glass group flex items-center gap-4 rounded-xl p-4 transition-colors duration-200 hover:bg-fg/5"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
            <Share2 className="size-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">Compartilhar</span>
            <span className="block text-[13px] text-fg-muted">
              Envie músicas direto para amigos (P2P)
            </span>
          </span>
        </Link>
      </div>
    </section>
  );
}

export default function HomePage() {
  // null = overall top songs; otherwise an Apple genre id.
  const [genreId, setGenreId] = useState<number | null>(null);
  const genreLabel = APPLE_GENRES.find((g) => g.id === genreId)?.label ?? null;

  const overall = useTopSongs('br');
  const byGenre = useTopSongsByGenre(genreId ?? 0, 'br');
  const top = genreId === null ? overall : byGenre;

  const freeTracks = useTrending();
  const playlists = useTrendingPlaylists();
  const community = useCommunityTrending(genreId);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracks: TrackDto[] = top.data ?? [];
  const free: TrackDto[] = freeTracks.data ?? [];
  const trendingTracks: TrackDto[] = community.data ?? [];

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

      {/* Featured: link-imported tracks shared by the community (first). */}
      {genreId === null && <CommunityTracksRow limit={20} />}

      {/* Your downloaded / on-device tracks (only when you have some). */}
      {genreId === null && <DeviceTracksRow limit={12} />}

      {/* Jump-back-in quick tiles (overall top only). */}
      {genreId === null && (
        <QuickTiles
          tracks={tracks}
          onPlay={(index) => playQueue(tracks, index, { source: 'home' })}
        />
      )}

      {/* Genre chips (Apple charts) */}
      <div
        role="tablist"
        aria-label="Filtrar por gênero"
        className="no-scrollbar flex gap-2 overflow-x-auto px-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={genreId === null}
          onClick={() => setGenreId(null)}
          className={cn(
            'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
            genreId === null
              ? 'bg-fg text-bg'
              : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
          )}
        >
          Tudo
        </button>
        {APPLE_GENRES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={genreId === g.id}
            onClick={() => setGenreId(g.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
              genreId === g.id
                ? 'bg-fg text-bg'
                : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
            )}
          >
            {g.label}
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
                  {genreLabel ? `Em alta · ${genreLabel}` : 'Em alta'}
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
                    previewOnly={track.previewOnly}
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

      {/* One-line disclosure on preview vs full-track playback. */}
      <p className="px-3 text-[12px] text-fg-subtle">
        As faixas em alta tocam em prévia de 30s (Apple). As faixas do acervo grátis tocam
        completas.
      </p>

      {/* Community trending — powered by everyone's likes (Firestore). */}
      {trendingTracks.length > 0 && (
        <SectionCarousel
          title={genreLabel ? `Em alta na comunidade · ${genreLabel}` : 'Em alta na comunidade'}
          subtitle="As mais curtidas pelos ouvintes do Aurial"
        >
          {trendingTracks.map((track, index) => (
            <MediaCard
              key={track.id}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              previewOnly={track.previewOnly}
              playing={currentTrack?.id === track.id && isPlaying}
              onPlay={() => playQueue(trendingTracks, index, { source: 'home' })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* Per-genre rows — only on the "Tudo" view, to keep the page alive. */}
      {genreId === null &&
        HOME_GENRE_ROWS.map((id) => {
          const label = APPLE_GENRES.find((g) => g.id === id)?.label ?? '';
          return <GenreRow key={id} genreId={id} label={label} />;
        })}

      {/* SECONDARY: Audius full-length free catalog. */}
      {free.length > 0 && (
        <section className={cn(freeTracks.isFetching && 'opacity-70 transition-opacity')}>
          <div className="mb-3 flex items-center justify-between px-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-fg">Grátis e completas</h2>
              <p className="mt-0.5 text-[13px] text-fg-muted">
                Artistas independentes no Audius — tocam por inteiro
              </p>
            </div>
            <button
              type="button"
              onClick={() => playQueue(free, 0, { source: 'home' })}
              className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
            >
              <Play className="size-3.5 fill-current" /> Tocar tudo
            </button>
          </div>
          <div
            aria-label="Faixas grátis e completas"
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto px-2 pb-1"
          >
            {free.map((track, index) => (
              <MediaCard
                key={track.id}
                title={track.title}
                subtitle={trackArtistNames(track)}
                imageUrl={track.coverUrl}
                playing={currentTrack?.id === track.id && isPlaying}
                onPlay={() => playQueue(free, index, { source: 'home' })}
              />
            ))}
          </div>
        </section>
      )}

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

      <DeviceShortcut />
    </div>
  );
}
