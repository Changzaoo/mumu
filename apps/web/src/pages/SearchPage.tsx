/**
 * /search — instant search with a 300ms debounce, top result, recent searches
 * and voice input. Two catalogs:
 *  - PRIMARY: Apple/iTunes real songs (top result + main list, 30s previews).
 *  - SECONDARY: Audius "Faixas completas (grátis)" full-length free tracks.
 * Artist results come from Audius.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { Mic, Search, SearchX, X } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PlayButton } from '@/components/media/PlayButton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppleSearch, useCatalogSearch, useCatalogSearchArtists } from '@/features/catalog/api';
import { useRecentSearches } from '@/features/search/api';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

type Tab = 'all' | 'track' | 'artist';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'track', label: 'Músicas' },
  { value: 'artist', label: 'Artistas' },
];

const artistPath = (id: string): string => `/catalogo/artista/${id.replace(/^audius-user:/, '')}`;

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
      aria-pressed={listening}
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
  const urlQuery = searchParams.get('q') ?? '';
  const [tab, setTab] = useState<Tab>('all');
  const [input, setInput] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(input, 300);
  const { recent, addRecent, removeRecent, clearRecent } = useRecentSearches();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // URL ← debounced input (replace to keep history clean while typing).
  useEffect(() => {
    setSearchParams(
      (params) => {
        if (debounced.trim()) params.set('q', debounced.trim());
        else params.delete('q');
        return params;
      },
      { replace: true },
    );
  }, [debounced, setSearchParams]);

  const appleQuery = useAppleSearch(debounced);
  const tracksQuery = useCatalogSearch(debounced);
  const artistsQuery = useCatalogSearchArtists(debounced);
  const hasQuery = debounced.trim().length > 0;

  const commitSearch = (term: string): void => {
    setInput(term);
    addRecent(term);
  };

  const appleTracks = appleQuery.data ?? [];
  const freeTracks = tracksQuery.data ?? [];
  const artists = artistsQuery.data ?? [];
  const showTracks = tab === 'all' || tab === 'track';
  const showArtists = tab === 'all' || tab === 'artist';
  const topTrack = tab === 'all' ? appleTracks[0] : undefined;

  const isLoading =
    hasQuery && (appleQuery.isLoading || tracksQuery.isLoading || artistsQuery.isLoading);
  const isError = hasQuery && appleQuery.isError && tracksQuery.isError && artistsQuery.isError;
  const isEmpty =
    hasQuery &&
    !isLoading &&
    !isError &&
    appleTracks.length === 0 &&
    freeTracks.length === 0 &&
    artists.length === 0;

  const playApple = (index: number): void => {
    addRecent(debounced);
    playQueue(appleTracks, index, { source: 'search', sourceId: debounced.trim() });
  };
  const playFree = (index: number): void => {
    addRecent(debounced);
    playQueue(freeTracks, index, { source: 'search', sourceId: debounced.trim() });
  };

  return (
    <div className="space-y-6 py-4">
      {/* Search input */}
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-fg-subtle" />
          <input
            ref={inputRef}
            autoFocus
            type="search"
            role="searchbox"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && input.trim()) addRecent(input);
              if (event.key === 'Escape') setInput('');
            }}
            placeholder="O que você quer ouvir?"
            aria-label="Buscar"
            className={cn(
              'h-12 w-full rounded-full border border-border bg-bg-elevated pl-12 pr-10 text-base text-fg',
              'placeholder:text-fg-subtle transition-colors duration-200',
              'hover:border-fg/20 focus:border-accent focus:outline-none',
            )}
          />
          {input && (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => {
                setInput('');
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:bg-fg/8 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <VoiceButton onResult={commitSearch} />
      </div>

      {/* Type pills */}
      <div
        role="tablist"
        aria-label="Filtrar por tipo"
        className="no-scrollbar flex gap-2 overflow-x-auto"
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
              title="Busque por músicas e artistas"
              description="Digite acima ou use a busca por voz para encontrar músicas livres no catálogo Audius."
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
            (appleQuery.isFetching || tracksQuery.isFetching || artistsQuery.isFetching) &&
              'opacity-70',
          )}
        >
          {isEmpty ? (
            <EmptyState
              icon={SearchX}
              title={`Nada encontrado para "${debounced.trim()}"`}
              description="Confira a grafia ou tente termos mais gerais."
            />
          ) : (
            <>
              {showTracks && topTrack && (
                <section aria-label="Melhor resultado" className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">
                    Melhor resultado
                  </h2>
                  <div className="group relative flex max-w-md flex-col justify-between rounded-xl border border-border bg-bg-elevated p-5">
                    <div className="size-24 overflow-hidden rounded-lg bg-fg/6 shadow-lg">
                      {topTrack.coverUrl && (
                        <img src={topTrack.coverUrl} alt="" className="size-full object-cover" />
                      )}
                    </div>
                    <div className="mt-4 min-w-0">
                      <p className="line-clamp-1 text-2xl font-bold tracking-tight text-fg">
                        {topTrack.title}
                      </p>
                      <p className="mt-1 line-clamp-1 text-[13px] text-fg-muted">
                        Música · {trackArtistNames(topTrack)}
                        {topTrack.previewOnly && ' · prévia 30s'}
                      </p>
                    </div>
                    <PlayButton
                      size="lg"
                      playing={currentTrack?.id === topTrack.id && isPlaying}
                      onClick={() => playApple(0)}
                      className="absolute bottom-5 right-5"
                    />
                  </div>
                </section>
              )}

              {showTracks && appleTracks.length > 0 && (
                <section aria-label="Músicas" className="min-w-0">
                  <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Músicas</h2>
                  <TrackList>
                    {appleTracks.map((track, index) => (
                      <TrackRow
                        key={`${track.id}:${index}`}
                        track={track}
                        index={index}
                        showAlbum={false}
                        active={track.id === currentTrack?.id}
                        playing={track.id === currentTrack?.id && isPlaying}
                        onPlay={() => playApple(index)}
                      />
                    ))}
                  </TrackList>
                </section>
              )}

              {showTracks && freeTracks.length > 0 && (
                <section aria-label="Faixas completas (grátis)" className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight text-fg">
                    Faixas completas (grátis)
                  </h2>
                  <p className="mb-3 mt-0.5 text-[13px] text-fg-muted">
                    Acervo Audius — tocam por inteiro
                  </p>
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
                <SectionCarousel title="Artistas">
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
