/**
 * /underground — Catálogo underground/indie via API.
 *
 * Exibe artistas, faixas trending, gêneros e localizações do catálogo underground.
 * Dados vêm da API /api/v1/underground/* (backend já implementado).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Search, TrendingUp, MapPin, Music, Loader2, Sparkles, ChevronRight } from 'lucide-react';
import { api, type ApiError } from '@/lib/api';
import { EmptyState } from '@/components/media/EmptyState';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import type { ArtistDto, TrackDto } from '@aurial/shared';

export default function UndergroundPage() {
  const [artists, setArtists] = useState<ArtistDto[]>([]);
  const [trendingTracks, setTrendingTracks] = useState<TrackDto[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ArtistDto[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function loadInitialData() {
    try {
      setLoading(true);
      setError(null);

      // `api` already unwraps the `{ data, meta }` envelope, so `data` IS the list.
      const [artistsRes, tracksRes, genresRes, locationsRes] = await Promise.all([
        api.get<ArtistDto[]>('/underground/artists', { anonymous: true }),
        api.get<TrackDto[]>('/underground/trending', {
          anonymous: true,
          query: { limit: 20 },
        }),
        api.get<string[]>('/underground/genres', { anonymous: true }),
        api.get<string[]>('/underground/locations', { anonymous: true }),
      ]);

      setArtists(artistsRes.data);
      setTrendingTracks(tracksRes.data);
      setGenres(genresRes.data);
      setLocations(locationsRes.data);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message ?? 'Falha ao carregar catálogo underground');
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    try {
      setSearching(true);
      const res = await api.get<ArtistDto[]>('/underground/artists/search', {
        anonymous: true,
        query: { q: searchQuery, limit: 20 },
      });
      setSearchResults(res.data);
    } catch (err) {
      const apiError = err as ApiError;
      console.error('Search failed:', apiError.message);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 py-4">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <Sparkles className="size-7 text-fg-muted" /> Underground
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Descubra artistas independentes, selos underground e sons fora do mainstream.
          </p>
        </header>
        <div className="space-y-8">
          <SectionCarousel title="Carregando artistas..." className="h-[320px]">
            <div className="flex gap-3 min-w-[200px]">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[160px] animate-pulse">
                  <div className="aspect-square rounded-lg bg-fg/10 mb-2" />
                  <div className="h-4 w-3/4 rounded bg-fg/10 mb-1" />
                  <div className="h-3 w-1/2 rounded bg-fg/10" />
                </div>
              ))}
            </div>
          </SectionCarousel>
          <SectionCarousel title="Carregando faixas..." className="h-[320px]">
            <div className="flex gap-3 min-w-[200px]">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[160px] animate-pulse">
                  <div className="aspect-square rounded-lg bg-fg/10 mb-2" />
                  <div className="h-4 w-3/4 rounded bg-fg/10 mb-1" />
                  <div className="h-3 w-1/2 rounded bg-fg/10" />
                </div>
              ))}
            </div>
          </SectionCarousel>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 py-4">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <Sparkles className="size-7 text-fg-muted" /> Underground
          </h1>
        </header>
        <EmptyState icon={Music} title="Não foi possível carregar" description={error} />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <Sparkles className="size-7 text-fg-muted" /> Underground
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Descubra artistas independentes, selos underground e sons fora do mainstream.
        </p>
      </header>

      {/* Search Bar */}
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-fg-muted" />
        <input
          type="search"
          placeholder="Buscar artistas underground..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-4 py-2.5 text-fg placeholder-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-5 animate-spin text-accent" />
        )}
      </div>

      {/* Search Results */}
      {searchResults !== null && (
        <section aria-label="Resultados da busca" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-fg">
              {searchResults.length > 0
                ? `Resultados para "${searchQuery}"`
                : `Nenhum artista encontrado para "${searchQuery}"`}
            </h2>
          </div>
          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {searchResults.map((artist, index) => (
                <motion.div
                  key={artist.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.2 }}
                >
                  <ArtistCard artist={artist} />
                </motion.div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Main Content - only show when not searching */}
      {searchResults === null && (
        <>
          {/* Trending Tracks */}
          {trendingTracks.length > 0 && (
            <section aria-label="Trending underground" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
                  <TrendingUp className="size-5 text-accent" /> Em alta no underground
                </h2>
                <Link
                  to="/underground/trending"
                  className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition-colors"
                >
                  Ver todos <ChevronRight className="size-4" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
                {trendingTracks.slice(0, 14).map((track, index) => (
                  <motion.div
                    key={track.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 14) * 0.03, duration: 0.2 }}
                  >
                    <TrackCard track={track} />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Artists Grid */}
          {artists.length > 0 && (
            <section aria-label="Artistas underground" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-fg">
                  Artistas em destaque
                </h2>
                <Link
                  to="/underground/artists"
                  className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition-colors"
                >
                  Ver todos <ChevronRight className="size-4" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {artists.slice(0, 18).map((artist, index) => (
                  <motion.div
                    key={artist.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 18) * 0.03, duration: 0.2 }}
                  >
                    <ArtistCard artist={artist} />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Genres */}
          {genres.length > 0 && (
            <section aria-label="Gêneros underground" className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight text-fg">Gêneros</h2>
              <div className="flex flex-wrap gap-2">
                {genres.map((genre) => (
                  <Link
                    key={genre}
                    to={`/underground/genre/${encodeURIComponent(genre)}`}
                    className="px-3 py-1.5 rounded-full border border-border bg-bg-elevated text-sm text-fg hover:bg-bg-hover hover:border-accent transition-colors"
                  >
                    {genre}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Locations */}
          {locations.length > 0 && (
            <section aria-label="Localizações underground" className="space-y-3">
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
                <MapPin className="size-5 text-fg-muted" /> Cenas locais
              </h2>
              <div className="flex flex-wrap gap-2">
                {locations.slice(0, 20).map((location) => (
                  <Link
                    key={location}
                    to={`/underground/location/${encodeURIComponent(location)}`}
                    className="px-3 py-1.5 rounded-full border border-border bg-bg-elevated text-sm text-fg hover:bg-bg-hover hover:border-accent transition-colors"
                  >
                    {location}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Empty State */}
          {artists.length === 0 &&
            trendingTracks.length === 0 &&
            genres.length === 0 &&
            locations.length === 0 && (
              <EmptyState
                icon={Music}
                title="Catálogo vazio"
                description="O catálogo underground ainda não tem dados. Verifique se a API está rodando e se há artistas cadastrados."
              />
            )}
        </>
      )}
    </div>
  );
}

/** Artist card for underground page */
function ArtistCard({ artist }: { artist: ArtistDto }) {
  const hue = hueFor(artist.name);

  return (
    <Link
      to={`/artist/${artist.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-border bg-bg-elevated transition-transform duration-200 hover:scale-[1.02] focus-visible:scale-[1.02]"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 60% 45% / 0.15) 0%, hsl(${(hue + 40) % 360} 60% 40% / 0.05) 100%)`,
      }}
    >
      <div className="aspect-square relative overflow-hidden">
        {artist.imageUrl ? (
          <img
            src={artist.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-transparent via-[hsl(var(--accent-h)_80%_30%_/_0.15)] to-transparent">
            <Music className="size-10 text-fg-muted/50" />
          </div>
        )}
        {artist.verified && (
          <span className="absolute right-2 top-2 flex h-5 items-center gap-1 rounded-full bg-black/70 px-2 text-[10px] font-medium text-white">
            ✓ Verificado
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="truncate font-semibold text-fg group-hover:text-accent transition-colors">
          {artist.name}
        </h3>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-fg-muted">
          {artist.catalogTag && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent font-medium">
              {artist.catalogTag}
            </span>
          )}
          {artist.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3 shrink-0" />
              {artist.location}
            </span>
          )}
        </div>
        {artist.monthlyListeners && artist.monthlyListeners > 0 && (
          <p className="mt-1 text-[12px] text-fg-muted">
            {formatCount(artist.monthlyListeners)} ouvintes/mês
          </p>
        )}
      </div>
    </Link>
  );
}

/** Track card for trending section */
function TrackCard({ track }: { track: TrackDto }) {
  return (
    <Link
      to={`/track/${track.id}`}
      className="group relative block overflow-hidden rounded-xl border border-border bg-bg-elevated transition-transform duration-200 hover:scale-[1.02] focus-visible:scale-[1.02]"
    >
      <div className="aspect-square relative overflow-hidden">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-transparent via-[hsl(var(--accent-h)_80%_30%_/_0.15)] to-transparent">
            <Music className="size-10 text-fg-muted/50" />
          </div>
        )}
        {track.previewOnly && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Preview
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        <div className="absolute bottom-2 left-2 right-2 translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 flex justify-center">
          <button
            className="size-10 rounded-full bg-white/90 backdrop-blur flex items-center justify-center text-fg hover:bg-white transition-colors shadow-lg"
            onClick={(e) => e.preventDefault()}
            aria-label="Tocar"
          >
            <svg className="size-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="p-3">
        <h3 className="truncate font-medium text-fg group-hover:text-accent transition-colors">
          {track.title}
        </h3>
        <p className="mt-0.5 truncate text-[12px] text-fg-muted">
          {track.artists.map((a) => a.name).join(', ')}
        </p>
        {track.genre && (
          <span className="mt-1 inline-block px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent font-medium">
            {track.genre}
          </span>
        )}
      </div>
    </Link>
  );
}

function hueFor(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) % 360;
  return hash;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
