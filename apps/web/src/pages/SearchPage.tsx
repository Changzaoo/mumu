/**
 * /search — instant search with type pills, top result, grouped carousels,
 * recent searches and (when supported) voice input.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { Mic, Search, SearchX, X } from 'lucide-react';
import type { SearchResultsDto, SearchType, TrackDto } from '@aurial/shared';
import { ArtistCard } from '@/components/media/ArtistCard';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PlayButton } from '@/components/media/PlayButton';
import { PlaylistCard } from '@/components/media/PlaylistCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrackLikes } from '@/features/library/api';
import { useRecentSearches, useSearch } from '@/features/search/api';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const TYPE_PILLS: Array<{ value: SearchType; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'track', label: 'Músicas' },
  { value: 'album', label: 'Álbuns' },
  { value: 'artist', label: 'Artistas' },
  { value: 'playlist', label: 'Playlists' },
  { value: 'podcast', label: 'Podcasts' },
  { value: 'radio', label: 'Rádios' },
];

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

// ── Top result ──────────────────────────────────────────────────

interface TopResultInfo {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  to?: string;
  round?: boolean;
  track?: TrackDto;
}

function resolveTopResult(results: SearchResultsDto): TopResultInfo | null {
  const top = results.topResult;
  if (!top) return null;
  switch (top.type) {
    case 'track': {
      const track = results.tracks.find((t) => t.id === top.id);
      return track
        ? {
            title: track.title,
            subtitle: `Música · ${trackArtistNames(track)}`,
            imageUrl: track.coverUrl,
            to: track.album ? `/album/${track.album.id}` : undefined,
            track,
          }
        : null;
    }
    case 'album': {
      const album = results.albums.find((a) => a.id === top.id);
      return album
        ? {
            title: album.title,
            subtitle: `Álbum · ${album.artists.map((a) => a.name).join(', ')}`,
            imageUrl: album.coverUrl,
            to: `/album/${album.id}`,
          }
        : null;
    }
    case 'artist': {
      const artist = results.artists.find((a) => a.id === top.id);
      return artist
        ? {
            title: artist.name,
            subtitle: 'Artista',
            imageUrl: artist.imageUrl,
            to: `/artist/${artist.id}`,
            round: true,
          }
        : null;
    }
    case 'playlist': {
      const playlist = results.playlists.find((p) => p.id === top.id);
      return playlist
        ? {
            title: playlist.title,
            subtitle: `Playlist · ${playlist.owner.displayName}`,
            imageUrl: playlist.coverUrl,
            to: `/playlist/${playlist.id}`,
          }
        : null;
    }
    case 'podcast': {
      const podcast = results.podcasts.find((p) => p.id === top.id);
      return podcast
        ? {
            title: podcast.title,
            subtitle: `Podcast · ${podcast.publisher}`,
            imageUrl: podcast.coverUrl,
            to: `/podcast/${podcast.id}`,
          }
        : null;
    }
    default:
      return null;
  }
}

function TopResultCard({ info, query }: { info: TopResultInfo; query: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = info.track ? currentTrack?.id === info.track.id : false;

  const body = (
    <div className="group relative flex h-full flex-col justify-between rounded-xl border border-border bg-bg-elevated p-5 transition-colors duration-200 hover:bg-fg/5">
      <div
        className={cn(
          'size-24 overflow-hidden bg-fg/6 shadow-lg',
          info.round ? 'rounded-full' : 'rounded-lg',
        )}
      >
        {info.imageUrl && <img src={info.imageUrl} alt="" className="size-full object-cover" />}
      </div>
      <div className="mt-4 min-w-0">
        <p className="line-clamp-1 text-2xl font-bold tracking-tight text-fg">{info.title}</p>
        <p className="mt-1 line-clamp-1 text-[13px] text-fg-muted">{info.subtitle}</p>
      </div>
      {info.track && (
        <PlayButton
          size="lg"
          playing={active && isPlaying}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (info.track) {
              playQueue([info.track], 0, { source: 'search', sourceId: query });
            }
          }}
          className={cn(
            'absolute bottom-5 right-5 translate-y-1 opacity-0 transition-[opacity,transform] duration-200',
            'group-hover:translate-y-0 group-hover:opacity-100',
            active && 'translate-y-0 opacity-100',
          )}
        />
      )}
    </div>
  );

  return (
    <section aria-label="Melhor resultado" className="min-w-0">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Melhor resultado</h2>
      {info.to ? (
        <Link to={info.to} className="block h-[calc(100%-2.25rem)]">
          {body}
        </Link>
      ) : (
        body
      )}
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Skeleton className="h-56 rounded-xl" />
        <div className="space-y-2 pt-9">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const urlType = (searchParams.get('type') ?? 'all') as SearchType;
  const [input, setInput] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(input, 300);
  const { recent, addRecent, removeRecent, clearRecent } = useRecentSearches();
  const likes = useTrackLikes();

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

  const { data, isLoading, isError, refetch, isFetching } = useSearch(debounced, urlType);
  const hasQuery = debounced.trim().length > 0;

  const setType = (type: SearchType): void => {
    setSearchParams(
      (params) => {
        if (type === 'all') params.delete('type');
        else params.set('type', type);
        return params;
      },
      { replace: true },
    );
  };

  const commitSearch = (term: string): void => {
    setInput(term);
    addRecent(term);
  };

  const topResult = data && urlType === 'all' ? resolveTopResult(data) : null;
  const tracksShown = data ? (urlType === 'all' ? data.tracks.slice(0, 5) : data.tracks) : [];

  const playFromSearch = (index: number): void => {
    if (!data) return;
    addRecent(debounced);
    playQueue(tracksShown, index, { source: 'search', sourceId: data.query });
  };

  const isEmptyResults =
    data &&
    data.tracks.length === 0 &&
    data.albums.length === 0 &&
    data.artists.length === 0 &&
    data.playlists.length === 0 &&
    data.podcasts.length === 0 &&
    data.radios.length === 0;

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
        {TYPE_PILLS.map((pill) => (
          <button
            key={pill.value}
            type="button"
            role="tab"
            aria-selected={urlType === pill.value}
            onClick={() => setType(pill.value)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
              urlType === pill.value
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
              title="Busque por músicas, artistas e mais"
              description="Digite acima ou use a busca por voz para encontrar qualquer coisa no Aurial."
            />
          )}
        </section>
      )}

      {/* Results */}
      {hasQuery && isLoading && <ResultsSkeleton />}
      {hasQuery && isError && (
        <div className="py-8">
          <ErrorState onRetry={() => void refetch()} />
        </div>
      )}

      {hasQuery && data && (
        <div className={cn('space-y-8 transition-opacity', isFetching && 'opacity-70')}>
          {data.correctedQuery && data.correctedQuery !== data.query && (
            <p className="text-sm text-fg-muted">
              Você quis dizer{' '}
              <button
                type="button"
                onClick={() => commitSearch(data.correctedQuery ?? '')}
                className="font-medium text-info hover:underline"
              >
                {data.correctedQuery}
              </button>
              ?
            </p>
          )}

          {isEmptyResults ? (
            <EmptyState
              icon={SearchX}
              title={`Nada encontrado para "${data.query}"`}
              description="Confira a grafia ou tente termos mais gerais."
            />
          ) : (
            <>
              <div
                className={cn(
                  'grid gap-6',
                  topResult &&
                    tracksShown.length > 0 &&
                    'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]',
                )}
              >
                {topResult && <TopResultCard info={topResult} query={data.query} />}
                {tracksShown.length > 0 && (
                  <section aria-label="Músicas" className="min-w-0">
                    <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Músicas</h2>
                    <TrackList>
                      {tracksShown.map((track, index) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          index={index}
                          showAlbum={false}
                          active={track.id === currentTrack?.id}
                          playing={track.id === currentTrack?.id && isPlaying}
                          liked={likes.isLiked(track)}
                          onToggleLike={(liked) => likes.toggle(track, liked)}
                          onPlay={() => playFromSearch(index)}
                        />
                      ))}
                    </TrackList>
                  </section>
                )}
              </div>

              {(urlType === 'all' || urlType === 'artist') && data.artists.length > 0 && (
                <SectionCarousel title="Artistas">
                  {data.artists.map((artist) => (
                    <ArtistCard key={artist.id} artist={artist} />
                  ))}
                </SectionCarousel>
              )}

              {(urlType === 'all' || urlType === 'album') && data.albums.length > 0 && (
                <SectionCarousel title="Álbuns">
                  {data.albums.map((album) => (
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

              {(urlType === 'all' || urlType === 'playlist') && data.playlists.length > 0 && (
                <SectionCarousel title="Playlists">
                  {data.playlists.map((playlist) => (
                    <PlaylistCard key={playlist.id} playlist={playlist} />
                  ))}
                </SectionCarousel>
              )}

              {(urlType === 'all' || urlType === 'podcast') && data.podcasts.length > 0 && (
                <SectionCarousel title="Podcasts">
                  {data.podcasts.map((podcast) => (
                    <MediaCard
                      key={podcast.id}
                      title={podcast.title}
                      subtitle={podcast.publisher}
                      imageUrl={podcast.coverUrl}
                      to={`/podcast/${podcast.id}`}
                    />
                  ))}
                </SectionCarousel>
              )}

              {(urlType === 'all' || urlType === 'radio') && data.radios.length > 0 && (
                <SectionCarousel title="Rádios">
                  {data.radios.map((radio) => (
                    <MediaCard
                      key={radio.id}
                      title={radio.name}
                      subtitle={radio.genre ? `Rádio · ${radio.genre}` : 'Rádio ao vivo'}
                      imageUrl={radio.imageUrl}
                      to="/radios"
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
