/**
 * / — Catalog home. Two data sources, clearly separated:
 *
 *  1. PRIMARY "Em alta" — the real mainstream hits from the Apple/iTunes charts
 *     (Drake, The Weeknd, Shakira…). These play as legal **30-second previews**
 *     (stream-only, never downloadable). Genre chips switch the chart.
 *  2. SECONDARY "Grátis e completas" — the Audius public catalog: independent
 *     artists whose tracks play in **full length** and can be downloaded/offline.
 *
 * The central Aurial backend is not deployed in the P2P topology, so both feeds
 * are read directly from their public APIs on the client.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { HardDriveDownload, Play, Share2 } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
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
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
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

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracks: TrackDto[] = top.data ?? [];
  const free: TrackDto[] = freeTracks.data ?? [];

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
