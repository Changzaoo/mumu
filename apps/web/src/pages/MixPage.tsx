/**
 * /mix/:key — a "Feito para você" auto mix opened as a full page (Spotify-like):
 * cover header + the whole tracklist. `key` is `genre:<name>` or `artist:<name>`
 * (the same ids HomePage builds). Playing from here shuffles, like a real mix.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Play, Shuffle, Sparkles } from 'lucide-react';
import { useParams } from 'react-router';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function mixFor(key: string): { title: string; tracks: TrackDto[]; cover: string | null } {
  const [kind, ...rest] = key.split(':');
  const name = rest.join(':');
  if (kind === 'genre') {
    const tracks = localLibrary.genreTracks(name);
    return { title: `Mix ${name}`, tracks, cover: tracks[0]?.coverUrl ?? null };
  }
  if (kind === 'artist') {
    const tracks = localLibrary.artistTracks(name);
    return { title: `Mix de ${name}`, tracks, cover: tracks[0]?.coverUrl ?? null };
  }
  return { title: 'Mix', tracks: [], cover: null };
}

export default function MixPage() {
  const { key = '' } = useParams<{ key: string }>();
  const mixKey = decodeURIComponent(key);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- entries drives recompute
  const mix = useMemo(() => mixFor(mixKey), [entries, mixKey]);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const playShuffled = (): void => {
    if (mix.tracks.length === 0) return;
    playQueue(shuffled(mix.tracks), 0, { source: 'library', sourceId: mixKey });
  };
  const playAt = (index: number): void => {
    playQueue(mix.tracks, index, { source: 'library', sourceId: mixKey });
  };

  if (mix.tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Sparkles}
          title="Mix vazio"
          description="As músicas desse mix não estão mais na sua biblioteca."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-44 shrink-0 overflow-hidden rounded-xl bg-fg/6 shadow-2xl sm:size-52">
          {mix.cover ? (
            <img src={mix.cover} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-fg-subtle">
              <Sparkles className="size-10" />
            </div>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            Feito para você
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-fg">{mix.title}</h1>
          <p className="text-sm text-fg-muted">
            {mix.tracks.length} {mix.tracks.length === 1 ? 'música' : 'músicas'} · embaralha ao
            tocar
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={playShuffled}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
            >
              <Shuffle className="size-4" /> Tocar mix
            </button>
            <button
              type="button"
              onClick={() => playAt(0)}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold text-fg transition-colors hover:bg-fg/5"
            >
              <Play className="size-4 fill-current" /> Em ordem
            </button>
          </div>
        </div>
      </header>

      <TrackList aria-label={mix.title}>
        {mix.tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            active={track.id === currentTrack?.id}
            playing={track.id === currentTrack?.id && isPlaying}
            liked={likes.isLiked(track)}
            onToggleLike={(liked) => likes.toggle(track, liked)}
            onPlay={() => playAt(index)}
          />
        ))}
      </TrackList>
    </div>
  );
}
