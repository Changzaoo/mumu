import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionCarouselProps extends ComponentProps<'section'> {
  title: string;
  subtitle?: string;
  /** "Mostrar tudo" target. */
  href?: string;
}

/**
 * Horizontal scroll-snap row with hover arrows (DESIGN §8).
 * Children should be cards (MediaCard already sets snap-start).
 */
export function SectionCarousel({
  title,
  subtitle,
  href,
  className,
  children,
  ...props
}: SectionCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const updateArrows = (): void => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollBy = (direction: 1 | -1): void => {
    const el = scrollerRef.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  return (
    <section className={cn('group/carousel relative', className)} {...props}>
      <header className="mb-3 flex items-end justify-between gap-4 px-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-fg-muted">{subtitle}</p>}
        </div>
        {href && (
          <Link
            to={href}
            className="shrink-0 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Mostrar tudo
          </Link>
        )}
      </header>

      <div
        ref={scrollerRef}
        onScroll={updateArrows}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {children}
      </div>

      {(['left', 'right'] as const).map((side) => {
        const enabled = canScroll[side];
        const Icon = side === 'left' ? ChevronLeft : ChevronRight;
        return (
          <button
            key={side}
            type="button"
            aria-label={side === 'left' ? 'Anterior' : 'Próximo'}
            onClick={() => scrollBy(side === 'left' ? -1 : 1)}
            className={cn(
              'glass absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full text-fg md:grid',
              side === 'left' ? 'left-1' : 'right-1',
              'opacity-0 transition-opacity duration-200 group-hover/carousel:opacity-100 focus-visible:opacity-100',
              !enabled && 'pointer-events-none !opacity-0',
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </section>
  );
}
