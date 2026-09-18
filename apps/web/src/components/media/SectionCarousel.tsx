import { Fragment, useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionCarouselProps extends ComponentProps<'section'> {
  title: string;
  subtitle?: string;
  /** "Mostrar tudo" target. */
  href?: string;
  /** Dá a volta ao chegar no fim (padrão). Só vale quando há fila para dar. */
  loop?: boolean;
}

/**
 * Horizontal scroll-snap row with hover arrows (DESIGN §8).
 * Children should be cards (MediaCard already sets snap-start).
 */
export function SectionCarousel({
  title,
  subtitle,
  href,
  loop = true,
  className,
  children,
  ...props
}: SectionCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  // A PRATELEIRA QUE NÃO ACABA.
  //
  // A fila termina numa parede: o dedo empurra, os cards acabam e fica um vão.
  // O truque é o de sempre — duas cópias da mesma fila, e quando a rolagem
  // passa do limite ela volta UMA CÓPIA inteira para trás, sem animação. Como
  // as duas cópias são idênticas pixel a pixel, o salto é invisível: quem rola
  // vê os cards seguirem em frente para sempre, nos dois sentidos.
  //
  // Só quando há fila para dar a volta (mais de uma tela e meia de cards):
  // com quatro cards que já cabem na tela, a segunda cópia seria só um eco
  // esquisito ao lado do original.
  const [looping, setLooping] = useState(false);
  // Um ajuste de `scrollLeft` feito por nós dispara `onScroll` de volta; a
  // marca evita que a volta se avalie a si mesma no mesmo quadro.
  const ajustando = useRef(false);

  const medir = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el) return;
    // Com duas cópias no ar, a fila de verdade é metade do que se mede.
    const unidade = looping ? el.scrollWidth / 2 : el.scrollWidth;
    const deveria = loop && unidade > el.clientWidth * 1.5;
    if (deveria !== looping) setLooping(deveria);
  }, [loop, looping]);

  const updateArrows = (): void => {
    const el = scrollerRef.current;
    if (!el) return;
    if (looping) {
      // Dando a volta, nunca há fim: as duas setas valem sempre.
      setCanScroll({ left: true, right: true });
      return;
    }
    setCanScroll({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };

  // A VOLTA. O ponto de repouso é o começo da segunda cópia, então sobra meia
  // fila de folga para cada lado; passando disso, anda (ou volta) uma cópia.
  const darAVolta = (): void => {
    const el = scrollerRef.current;
    if (!el || !looping || ajustando.current) return;
    const unidade = el.scrollWidth / 2;
    if (unidade < 1) return;
    const alvo =
      el.scrollLeft >= unidade * 1.5
        ? el.scrollLeft - unidade
        : el.scrollLeft <= unidade * 0.5
          ? el.scrollLeft + unidade
          : null;
    if (alvo === null) return;
    ajustando.current = true;
    // `scroll-smooth` animaria o salto — e aí ele deixaria de ser invisível.
    const antes = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = alvo;
    el.style.scrollBehavior = antes;
    requestAnimationFrame(() => {
      ajustando.current = false;
    });
  };

  useEffect(() => {
    medir();
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      medir();
      updateArrows();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medir, children]);

  // Ao ligar a volta, o repouso passa a ser o começo da segunda cópia.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !looping) return;
    const antes = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = el.scrollWidth / 2;
    el.style.scrollBehavior = antes;
    updateArrows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping]);

  const scrollBy = (direction: 1 | -1): void => {
    const el = scrollerRef.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  return (
    <section
      className={cn(
        'group/carousel relative',
        // Prateleiras fora da tela nem chegam a renderizar (RAM/CPU no mobile).
        '[content-visibility:auto] [contain-intrinsic-size:auto_18rem]',
        className,
      )}
      {...props}
    >
      <header className="mb-3 flex items-end justify-between gap-4 px-3">
        <div>
          {href ? (
            <Link to={href} className="group/title inline-block">
              <h2 className="text-xl font-bold tracking-tight text-fg group-hover/title:underline">
                {title}
              </h2>
            </Link>
          ) : (
            <h2 className="text-xl font-bold tracking-tight text-fg">{title}</h2>
          )}
          {subtitle && <p className="mt-0.5 text-[13px] text-fg-muted">{subtitle}</p>}
        </div>
        {href && (
          <Link
            to={href}
            className="shrink-0 text-[13px] font-semibold text-fg-muted transition-colors hover:text-fg hover:underline"
          >
            Mostrar tudo
          </Link>
        )}
      </header>

      <div
        ref={scrollerRef}
        onScroll={() => {
          darAVolta();
          updateArrows();
        }}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {/* A segunda cópia é decorativa: para quem usa leitor de tela a fila já
            foi lida uma vez, e ouvir tudo em dobro seria ruído. */}
        {children}
        {looping && (
          <Fragment key="volta">
            <div aria-hidden className="contents">
              {children}
            </div>
          </Fragment>
        )}
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
