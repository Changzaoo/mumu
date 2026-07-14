/**
 * /search — results render INLINE on this page while you type in the TopBar
 * search field (Spotify behaviour: one search box, same screen, no modal).
 * Sections: your OWN library first (músicas / artistas / álbuns), then the
 * free catalog (Audius). Recent searches + voice input when the query is empty.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { Mic, Search, SearchX, X } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import { MediaCard } from '@/components/media/MediaCard';
import { PlayButton } from '@/components/media/PlayButton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useCatalogSearch, useCatalogSearchArtists } from '@/features/catalog/api';
import { useRecentSearches } from '@/features/search/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { useSyncExternalStore } from 'react';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

type Tab = 'all' | 'track' | 'artist' | 'album';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'track', label: 'Músicas' },
  { value: 'artist', label: 'Artistas' },
  { value: 'album', label: 'Álbuns' },
];

const artistPath = (id: string): string => `/catalogo/artista/${id.replace(/^audius-user:/, '')}`;

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
function norm(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(DIACRITICS, '').trim();
}

const EMPTY_ENTRIES: localLibrary.LibraryEntry[] = [];

// ── Voice search (webkitSpeechRecognition; hidden when unsupported) ──

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function VoiceButton({ onResult }: { onResult: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const Recognition = useMemo(getSpeechRecognition, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);
  if (!Recognition) return null;

  const toggle = (): void => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      aria-label={listening ? 'Parar busca por voz' : 'Buscar por voz'}
      onClick={toggle}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200',
        listening ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/8 hover:text-fg',
      )}
    >
      <Mic className={cn('size-4', listening && 'animate-pulse')} />
    </button>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim();
  const [tab, setTab] = useState<Tab>('all');
  const { recent, addRecent, removeRecent, clearRecent } = useRecentSearches();

  const entries = useSyncExternalStore(
    localLibrary.subscribe,
    localLibrary.list,
    () => EMPTY_ENTRIES,
  );

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracksQuery = useCatalogSearch(query);
  const artistsQuery = useCatalogSearchArtists(query);
  const hasQuery = query.length > 0;

  // Record a search once the user commits to a result set (small delay).
  useEffect(() => {
    if (!hasQuery) return;
    const timer = setTimeout(() => addRecent(query), 2500);
    return () => clearTimeout(timer);
  }, [query, hasQuery, addRecent]);

  const commitSearch = (term: string): void => {
    setSearchParams(term.trim() ? { q: term.trim() } : {}, { replace: true });
    addRecent(term);
  };

  // ── your OWN library, searched locally (instant) ──
  const local = useMemo(() => {
    const nq = norm(query);
    if (!nq) return { tracks: [], artists: [], albums: [] };
    const tracks = entries
      .map((e) => e.track)
      .filter((t) => norm(t.title).includes(nq) || t.artists.some((a) => norm(a.name).includes(nq)))
      .slice(0, 10);
    const artists = localLibrary
      .artists()
      .filter((a) => norm(a.name).includes(nq))
      .slice(0, 10);
    const albums = localLibrary
      .albumGroups()
      .filter((al) => norm(al.title).includes(nq) || norm(al.artist).includes(nq))
      .slice(0, 10);
    return { tracks, artists, albums };
  }, [entries, query]);

  const freeTracks = tracksQuery.data ?? [];
  const artists = artistsQuery.data ?? [];
  const showTracks = tab === 'all' || tab === 'track';
  const showArtists = tab === 'all' || tab === 'artist';
  const showAlbums = tab === 'all' || tab === 'album';
  const topLocal = showTracks ? local.tracks[0] : undefined;

  const isLoading =
    hasQuery && local.tracks.length === 0 && (tracksQuery.isLoading || artistsQuery.isLoading);
  const isError = hasQuery && tracksQuery.isError && artistsQuery.isError;
  const isEmpty =
    hasQuery &&
    !isLoading &&
    !isError &&
    freeTracks.length === 0 &&
    artists.length === 0 &&
    local.tracks.length === 0 &&
    local.artists.length === 0 &&
    local.albums.length === 0;

  const playLocal = (index: number): void => {
    addRecent(query);
    playQueue(local.tracks, index, { source: 'search', sourceId: query });
  };
  const playFree = (index: number): void => {
    addRecent(query);
    playQueue(freeTracks, index, { source: 'search', sourceId: query });
  };

  return (
    <div className="space-y-6 py-4">
      {/* Type pills + voice — the search FIELD lives in the TopBar. */}
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar por tipo"
          className="no-scrollbar flex flex-1 gap-2 overflow-x-auto"
        >
          {TABS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              role="tab"
              aria-selected={tab === pill.value}
              onClick={() => setTab(pill.value)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
                tab === pill.value
                  ? 'bg-fg text-bg'
                  : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
        <VoiceButton onResult={commitSearch} />
      </div>

      {/* Recent searches (empty input) */}
      {!hasQuery && (
        <section aria-label="Buscas recentes" className="pt-4">
          {recent.length > 0 ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-fg">Buscas recentes</h2>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Limpar tudo
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <motion.span
                    key={term}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated pl-1 pr-1 text-sm text-fg"
                  >
                    <button
                      type="button"
                      onClick={() => commitSearch(term)}
                      className="rounded-full py-1.5 pl-2.5 pr-1 hover:text-accent"
                    >
                      {term}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remover ${term} das buscas recentes`}
                      onClick={() => removeRecent(term)}
                      className="grid size-6 place-items-center rounded-full text-fg-muted hover:bg-fg/8 hover:text-fg"
                    >
                      <X className="size-3.5" />
                    </button>
                  </motion.span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={Search}
              title="Busque por músicas, artistas e álbuns"
              description="Digite na barra de busca lá em cima — os resultados aparecem aqui na mesma tela."
            />
          )}
        </section>
      )}

      {/* Results */}
      {isLoading && <ResultsSkeleton />}
      {isError && (
        <div className="py-8">
          <ErrorState
            onRetry={() => {
              void tracksQuery.refetch();
              void artistsQuery.refetch();
            }}
          />
        </div>
      )}

      {hasQuery && !isLoading && !isError && (
        <div
          className={cn(
            'space-y-8 transition-opacity',
            (tracksQuery.isFetching || artistsQuery.isFetching) && 'opacity-70',
          )}
        >
          {isEmpty ? (
            <EmptyState
              icon={SearchX}
              title={`Nada encontrado para "${query}"`}
              description="Confira a grafia ou tente termos mais gerais."
            />
          ) : (
            <>
              {topLocal && (
                <section aria-label="Melhor resultado" className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">
                    Melhor resultado
                  </h2>
                  <div className="group relative flex max-w-md flex-col justify-between rounded-xl border border-border bg-bg-elevated p-5">
                    <div className="size-24 overflow-hidden rounded-lg bg-fg/6 shadow-lg">
                      {topLocal.coverUrl && (
                        <img src={topLocal.coverUrl} alt="" className="size-full object-cover" />
                      )}
                    </div>
                    <div className="mt-4 min-w-0">
                      <p className="line-clamp-1 text-2xl font-bold tracking-tight text-fg">
                        {topLocal.title}
                      </p>
                      <p className="mt-1 line-clamp-1 text-[13px] text-fg-muted">
                        Música · {trackArtistNames(topLocal)}
                      </p>
                    </div>
                    <PlayButton
                      size="lg"
                      playing={currentTrack?.id === topLocal.id && isPlaying}
                      onClick={() => playLocal(0)}
                      className="absolute bottom-5 right-5"
                    />
                  </div>
                </section>
              )}

              {showTracks && local.tracks.length > 0 && (
                <section aria-label="Suas músicas" className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">
                    Suas músicas
                  </h2>
                  <TrackList>
                    {local.tracks.map((track, index) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        index={index}
                        showAlbum={false}
                        active={track.id === currentTrack?.id}
                        playing={track.id === currentTrack?.id && isPlaying}
                        onPlay={() => playLocal(index)}
                      />
                    ))}
                  </TrackList>
                </section>
              )}

              {showArtists && local.artists.length > 0 && (
                <SectionCarousel title="Seus artistas">
                  {local.artists.map((artist) => (
                    <LocalArtistCard
                      key={artist.name}
                      name={artist.name}
                      trackCount={artist.trackCount}
                      fallbackImage={artist.coverUrl}
                    />
                  ))}
                </SectionCarousel>
              )}

              {showAlbums && local.albums.length > 0 && (
                <SectionCarousel title="Seus álbuns">
                  {local.albums.map((album) => (
                    <MediaCard
                      key={album.key}
                      title={album.title}
                      subtitle={album.artist}
                      imageUrl={album.coverUrl}
                      to={`/disco/${encodeURIComponent(album.key)}`}
                      onPlay={() =>
                        playQueue(album.tracks, 0, {
                          source: 'search',
                          sourceId: `album:${album.key}`,
                        })
                      }
                    />
                  ))}
                </SectionCarousel>
              )}

              {showTracks && freeTracks.length > 0 && (
                <section aria-label="No catálogo grátis" className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">
                    No catálogo grátis
                  </h2>
                  <TrackList>
                    {freeTracks.map((track, index) => (
                      <TrackRow
                        key={`${track.id}:${index}`}
                        track={track}
                        index={index}
                        showAlbum={false}
                        active={track.id === currentTrack?.id}
                        playing={track.id === currentTrack?.id && isPlaying}
                        onPlay={() => playFree(index)}
                      />
                    ))}
                  </TrackList>
                </section>
              )}

              {showArtists && artists.length > 0 && (
                <SectionCarousel title="Artistas no catálogo">
                  {artists.map((artist) => (
                    <MediaCard
                      key={artist.id}
                      title={artist.name}
                      subtitle="Artista"
                      shape="round"
                      imageUrl={artist.imageUrl}
                      to={artistPath(artist.id)}
                    />
                  ))}
                </SectionCarousel>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
