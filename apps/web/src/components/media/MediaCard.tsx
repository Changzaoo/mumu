import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { Music } from 'lucide-react';
import { PlayButton } from '@/components/media/PlayButton';
import { cn } from '@/lib/utils';

export interface MediaCardProps extends ComponentProps<'div'> {
  title: string;
  subtitle?: ReactNode;
  imageUrl?: string | null;
  /** round = artists (DESIGN §8). */
  shape?: 'square' | 'round';
  /** Route target for the whole card. */
  to?: string;
  onPlay?: () => void;
  playing?: boolean;
  /** Show a "30s" corner badge (stream-only Apple preview tracks). */
  previewOnly?: boolean;
}

/**
 * Generic artwork card: hover scale 1.03 on the art + PlayButton fade-in
 * (transform/opacity only — DESIGN §5/§6).
 */
export function MediaCard({
  title,
  subtitle,
  imageUrl,
  shape = 'square',
  to,
  onPlay,
  playing = false,
  previewOnly = false,
  className,
  ...props
}: MediaCardProps) {
  const rounded = shape === 'round' ? 'rounded-full' : 'rounded-lg';
  // A play-only card (no route) plays when tapped anywhere — no hunting for the
  // little corner button.
  const clickable = Boolean(onPlay) && !to;

  const art = (
    <div className={cn('relative aspect-square overflow-hidden bg-fg/6', rounded)}>
      {previewOnly && (
        <span
          aria-label="Prévia de 30 segundos"
          title="Prévia de 30 segundos"
          className="glass absolute left-2 top-2 z-10 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-fg-muted"
        >
          30s
        </span>
      )}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div className="grid size-full place-items-center text-fg-subtle">
          <Music className="size-8" />
        </div>
      )}
      {onPlay && (
        <PlayButton
          playing={playing}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPlay();
          }}
          className={cn(
            'absolute bottom-2 right-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-200',
            'group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100',
            playing && 'translate-y-0 opacity-100',
          )}
        />
      )}
    </div>
  );

  const body = (
    <>
      {art}
      <div className={cn('mt-3 space-y-0.5', shape === 'round' && 'text-center')}>
        <p className="line-clamp-1 text-sm font-medium text-fg">{title}</p>
        {subtitle && <p className="line-clamp-2 text-[13px] text-fg-muted">{subtitle}</p>}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        'group w-40 shrink-0 snap-start rounded-xl p-3 transition-colors duration-200 hover:bg-fg/5 md:w-44',
        clickable && 'cursor-pointer',
        className,
      )}
      {...(clickable
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `Reproduzir ${title}`,
            onClick: onPlay,
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onPlay?.();
              }
            },
          }
        : {})}
      {...props}
    >
      {to ? (
        <Link to={to} className="block focus-visible:outline-none" aria-label={title}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
