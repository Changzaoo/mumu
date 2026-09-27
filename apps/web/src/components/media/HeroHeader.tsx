import type { ComponentProps, ReactNode } from 'react';
import { ImagePlus, Music } from 'lucide-react';
import { useDominantColor } from '@/hooks/useDominantColor';
import { cn } from '@/lib/utils';

export interface HeroHeaderProps extends ComponentProps<'header'> {
  /** Type label — "Playlist", "Álbum", "Artista"… */
  type: string;
  title: string;
  imageUrl?: string | null;
  /** Round artwork (artists). */
  round?: boolean;
  /** Pre-computed dominant color (e.g. AlbumDto.dominantColor); falls back to extraction. */
  dominantColor?: string | null;
  /** Meta row under the title (owner, year, duration…). */
  meta?: ReactNode;
  /** Actions row (PlayButton, follow, menu…). */
  actions?: ReactNode;
  /**
   * A capa vira um botão ("Trocar capa") — para quem pode editar. Trocar a capa
   * pela própria capa é o gesto que a pessoa tenta primeiro; escondido num menu
   * de três pontinhos, quase ninguém achava.
   */
  onTrocarCapa?: () => void;
}

/**
 * Page hero (DESIGN §8): 232px art, type label, huge title and an ambient
 * dominant-color glow — blurred 120px at 25% opacity, the only gradient
 * allowed in the system (DESIGN §2).
 */
export function HeroHeader({
  type,
  title,
  imageUrl,
  round = false,
  dominantColor,
  meta,
  actions,
  onTrocarCapa,
  className,
  children,
  ...props
}: HeroHeaderProps) {
  const extracted = useDominantColor(dominantColor ? null : imageUrl);
  const glow = dominantColor ?? extracted ?? 'hsl(var(--accent))';

  return (
    <header className={cn('relative', className)} {...props}>
      {/* Ambient glow — pure decoration, never intercepts pointer events. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -top-32 h-96 opacity-25 blur-[120px]"
        style={{ background: `radial-gradient(60% 60% at 35% 30%, ${glow} 0%, transparent 70%)` }}
      />

      <div className="relative flex flex-col items-center gap-6 pb-2 pt-4 md:flex-row md:items-end">
        {(() => {
          const arte = imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-fg-subtle">
              <Music className="size-12" />
            </div>
          );
          const moldura = cn(
            'size-44 shrink-0 overflow-hidden bg-fg/6 shadow-xl md:size-[232px]',
            round ? 'rounded-full' : 'rounded-xl',
          );
          if (!onTrocarCapa) return <div className={moldura}>{arte}</div>;
          return (
            <button
              type="button"
              onClick={onTrocarCapa}
              aria-label="Trocar capa"
              className={cn(moldura, 'group relative')}
            >
              {arte}
              {/* No toque não há "passar o mouse": o selo fica sempre à vista. */}
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/55 py-2 text-xs font-medium text-white transition-opacity md:inset-0 md:bg-black/50 md:py-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                <ImagePlus className="size-4" /> Trocar capa
              </span>
            </button>
          );
        })()}

        <div className="flex min-w-0 flex-col items-center gap-3 text-center md:items-start md:text-left">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fg-muted">
            {type}
          </span>
          <h1 className="line-clamp-2 text-4xl font-bold tracking-tight text-fg md:text-5xl">
            {title}
          </h1>
          {meta && (
            <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px] text-fg-muted md:justify-start">
              {meta}
            </div>
          )}
          {actions && <div className="mt-2 flex items-center gap-3">{actions}</div>}
        </div>
      </div>
      {children}
    </header>
  );
}
