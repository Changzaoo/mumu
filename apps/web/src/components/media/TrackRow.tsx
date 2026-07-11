import { Fragment, type ComponentProps, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Disc3,
  ListEnd,
  ListPlus,
  MicVocal,
  MoreHorizontal,
  Music,
  Pause,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TrackDto } from '@aurial/shared';
import { LikeButton } from '@/components/media/LikeButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDuration, cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Animated "now playing" bars (pauses with playback). */
function EqBars({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[3px]">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-[3px] origin-bottom rounded-full bg-accent animate-eq-bar"
          style={{
            animationDelay: `${bar * 150}ms`,
            animationPlayState: playing ? 'running' : 'paused',
            height: `${[70, 100, 55][bar] ?? 100}%`,
          }}
        />
      ))}
    </span>
  );
}

export interface TrackRowProps extends Omit<ComponentProps<'div'>, 'onPlay'> {
  track: TrackDto;
  /** Zero-based position; rendered as index + 1. */
  index: number;
  /** This row is the current track (accent title + bars icon). */
  active?: boolean;
  /** Audio actually running (animates the bars). */
  playing?: boolean;
  liked?: boolean;
  onToggleLike?: (liked: boolean) => void;
  onPlay?: () => void;
  /** Features layer hook — hides the menu item when absent. */
  onAddToPlaylist?: (track: TrackDto) => void;
  showAlbum?: boolean;
  showArt?: boolean;
}

/**
 * 56px track row (DESIGN §8): index↔play swap on hover, 40px art, artist/album
 * links, mono duration, like + menu revealed on hover. Roving focus friendly —
 * render inside `TrackList` (or pass tabIndex yourself when virtualizing).
 */
export function TrackRow({
  track,
  index,
  active = false,
  playing = false,
  liked = false,
  onToggleLike,
  onPlay,
  onAddToPlaylist,
  showAlbum = true,
  showArt = true,
  className,
  ...props
}: TrackRowProps) {
  const navigate = useNavigate();
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNextInQueue = usePlayerStore((s) => s.playNext);
  const toggle = usePlayerStore((s) => s.toggle);

  const handlePlay = (): void => {
    if (active) toggle();
    else onPlay?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handlePlay();
    }
  };

  const primaryArtistId = track.artists[0]?.id;

  return (
    <div
      role="listitem"
      data-track-row
      tabIndex={-1}
      aria-label={`${track.title} — ${trackArtistNames(track)}`}
      onDoubleClick={handlePlay}
      onKeyDown={handleKeyDown}
      className={cn(
        'group grid h-14 select-none grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 transition-colors duration-200',
        showAlbum && 'md:grid-cols-[2rem_minmax(0,4fr)_minmax(0,3fr)_auto]',
        'hover:bg-fg/5 focus-visible:bg-fg/5',
        className,
      )}
      {...props}
    >
      {/* index ↔ play swap */}
      <span className="grid size-8 place-items-center justify-self-center">
        <span
          className={cn(
            'font-mono text-[13px] tabular-nums text-fg-muted group-hover:hidden group-focus-within:hidden',
            active && 'hidden',
          )}
        >
          {index + 1}
        </span>
        {active && !playing ? null : active ? (
          <span className="group-hover:hidden group-focus-within:hidden">
            <EqBars playing={playing} />
          </span>
        ) : null}
        <button
          type="button"
          aria-label={active && playing ? `Pausar ${track.title}` : `Reproduzir ${track.title}`}
          onClick={handlePlay}
          className={cn(
            'hidden size-8 place-items-center rounded-full text-fg transition-colors hover:text-accent',
            'group-hover:grid group-focus-within:grid',
            active && !playing && 'grid',
          )}
        >
          {active && playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" />
          )}
        </button>
      </span>

      {/* title + artists */}
      <div className="flex min-w-0 items-center gap-3">
        {showArt && (
          <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-fg/6">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-fg-subtle">
                <Music className="size-4" />
              </span>
            )}
          </span>
        )}
        <div className="min-w-0">
          <p className={cn('line-clamp-1 text-sm font-medium', active ? 'text-accent' : 'text-fg')}>
            {track.title}
            {track.explicit && (
              <span
                aria-label="Conteúdo explícito"
                className="ml-1.5 inline-grid size-4 -translate-y-px place-items-center rounded-[4px] bg-fg/10 align-middle text-[9px] font-bold text-fg-muted"
              >
                E
              </span>
            )}
          </p>
          <p className="line-clamp-1 text-[13px] text-fg-muted">
            {track.artists.map((artist, i) => (
              <Fragment key={artist.id}>
                {i > 0 && ', '}
                <Link
                  to={`/artist/${artist.id}`}
                  className="hover:text-fg hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {artist.name}
                </Link>
              </Fragment>
            ))}
          </p>
        </div>
      </div>

      {/* album (hidden on small screens) */}
      {showAlbum && (
        <span className="hidden min-w-0 md:block">
          {track.album && (
            <Link
              to={`/album/${track.album.id}`}
              className="line-clamp-1 text-[13px] text-fg-muted hover:text-fg hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {track.album.title}
            </Link>
          )}
        </span>
      )}

      {/* like + duration + menu */}
      <div className="flex items-center gap-1">
        <LikeButton
          liked={liked}
          onToggle={onToggleLike}
          className={cn(
            'opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100',
            liked && 'opacity-100',
          )}
        />
        <span className="w-12 text-right font-mono text-[13px] tabular-nums text-fg-muted">
          {formatDuration(track.durationMs)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Mais opções para ${track.title}`}
              className={cn(
                'grid size-8 place-items-center rounded-full text-fg-muted opacity-0 transition-[opacity,color] duration-200',
                'hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100',
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                addToQueue(track);
                toast('Adicionada à fila');
              }}
            >
              <ListEnd /> Adicionar à fila
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                playNextInQueue(track);
                toast('Tocará em seguida');
              }}
            >
              <ListPlus /> Tocar em seguida
            </DropdownMenuItem>
            {onAddToPlaylist && (
              <DropdownMenuItem onSelect={() => onAddToPlaylist(track)}>
                <ListPlus /> Adicionar à playlist
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {track.album && (
              <DropdownMenuItem onSelect={() => void navigate(`/album/${track.album?.id}`)}>
                <Disc3 /> Ir para o álbum
              </DropdownMenuItem>
            )}
            {primaryArtistId && (
              <DropdownMenuItem onSelect={() => void navigate(`/artist/${primaryArtistId}`)}>
                <MicVocal /> Ir para o artista
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Roving-focus list container for TrackRow (DESIGN §10):
 * Tab enters the list, ↑/↓/Home/End move between rows, Enter/Space plays.
 */
export function TrackList({ className, children, ...props }: ComponentProps<'div'>) {
  const focusRow = (container: HTMLElement, direction: 1 | -1 | 'first' | 'last'): void => {
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-track-row]'));
    if (rows.length === 0) return;
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = current
      ? rows.indexOf(current.closest('[data-track-row]') as HTMLElement)
      : -1;
    let next: HTMLElement | undefined;
    if (direction === 'first') next = rows[0];
    else if (direction === 'last') next = rows[rows.length - 1];
    else next = rows[Math.min(rows.length - 1, Math.max(0, currentIndex + direction))];
    next?.focus();
  };

  return (
    <div
      role="list"
      tabIndex={0}
      className={cn('outline-none', className)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) focusRow(event.currentTarget, 'first');
      }}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            focusRow(event.currentTarget, 1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            focusRow(event.currentTarget, -1);
            break;
          case 'Home':
            event.preventDefault();
            focusRow(event.currentTarget, 'first');
            break;
          case 'End':
            event.preventDefault();
            focusRow(event.currentTarget, 'last');
            break;
          default:
            break;
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
}
