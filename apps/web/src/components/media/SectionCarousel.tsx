import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Folga de rolagem de cada lado do repouso (px) — um arremesso forte. */
const FOLGA_PX = 4000;
/** Teto de cópias (prateleira de 2-3 capas não vira centenas de cards). */
const COPIAS_MAX = 9;

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
  // TRÊS cópias da mesma fila, e o repouso é o começo da do MEIO: sobra uma
  // fila inteira de folga para cada lado. Quando a rolagem PARA longe do meio,
  // ela volta exatamente uma cópia, sem animação — como as cópias são
  // idênticas pixel a pixel, o salto é invisível e a fila segue para sempre,
  // nos dois sentidos.
  //
  // O salto só acontece com a rolagem PARADA. Antes ele acontecia no meio do
  // arremesso do dedo: no iPhone, mexer em `scrollLeft` durante o embalo corta
  // o embalo e redesenha a fila — as capas piscavam e a prateleira parecia
  // acabar logo. Com uma fila inteira de folga, nenhum arremesso chega à borda
  // antes de parar.
  //
  // Só quando há fila para dar a volta (mais de uma tela e meia de cards).
  const [looping, setLooping] = useState(false);
  // Quantas cópias: o bastante para sobrar ~4000 px de folga de cada lado do
  // meio (um arremesso forte no celular). Fila longa → 3; prateleira curta de
  // 8 capas → mais cópias, senão o dedo bateria na borda.
  const [copias, setCopias] = useState(3);
  const meio = Math.floor(copias / 2);
  const tocando = useRef(false);
  const parouTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capasCedo = useRef(false);

  /** Largura exata de uma cópia (cards + vãos), medida entre os primeiros cards. */
  const unidadeDe = (el: HTMLDivElement): number => {
    const a = el.querySelector<HTMLElement>('[data-copia="0"] > *');
    const b = el.querySelector<HTMLElement>('[data-copia="1"] > *');
    return a && b ? b.offsetLeft - a.offsetLeft : 0;
  };

  const medir = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el) return;
    const unidade = looping ? unidadeDe(el) : el.scrollWidth;
    const deveria = loop && unidade > el.clientWidth * 1.5;
    if (deveria !== looping) setLooping(deveria);
    if (unidade > 0) {
      const lado = Math.ceil(FOLGA_PX / unidade);
      const n = Math.min(COPIAS_MAX, Math.max(3, 2 * lado + 1));
      if (n !== copias) setCopias(n);
    }
  }, [loop, looping, copias]);

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

  /** Volta para a cópia do meio — só com a rolagem parada e o dedo fora. */
  const recentrar = (forcar = false): void => {
    const el = scrollerRef.current;
    if (!el || !looping || (tocando.current && !forcar)) return;
    const unidade = unidadeDe(el);
    if (unidade < 1) return;
    // Repouso = `meio` cópias inteiras de rolagem (o começo da do meio). Anda
    // um número INTEIRO de cópias até cair a menos de meia cópia dele.
    const desvio = Math.round((el.scrollLeft - unidade * meio) / unidade);
    if (desvio === 0) return;
    const alvo = el.scrollLeft - desvio * unidade;
    // `scroll-smooth` animaria o salto — e aí ele deixaria de ser invisível.
    const antes = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = alvo;
    el.style.scrollBehavior = antes;
  };

  /**
   * Trava de segurança: se, mesmo com a folga, a rolagem chegar a uma tela da
   * borda, volta já — cortar o embalo é melhor que o dedo bater numa parede.
   */
  const pertoDaBorda = (): void => {
    const el = scrollerRef.current;
    if (!el || !looping) return;
    const max = el.scrollWidth - el.clientWidth;
    if (el.scrollLeft < el.clientWidth || el.scrollLeft > max - el.clientWidth) recentrar(true);
  };

  const quandoParar = (): void => {
    if (parouTimer.current) clearTimeout(parouTimer.current);
    parouTimer.current = setTimeout(() => recentrar(), 180);
  };

  /**
   * As capas das cópias vêm com `loading="lazy"`: rolando rápido, cada uma
   * entrava vazia e "piscava" ao carregar. Na primeira vez que a pessoa mexe
   * NESTA prateleira, todas passam a carregar já — são as mesmas URLs, então é
   * uma ida à rede por capa, não três.
   */
  const carregarCapas = (): void => {
    if (capasCedo.current) return;
    capasCedo.current = true;
    scrollerRef.current
      ?.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')
      .forEach((img) => {
        img.loading = 'eager';
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

  // Ao ligar a volta, o repouso passa a ser o começo da cópia do meio.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !looping) return;
    const doMeio = el.querySelector<HTMLElement>(`[data-copia="${meio}"] > *`);
    const inicio = el.querySelector<HTMLElement>('[data-copia="0"] > *');
    if (!doMeio || !inicio) return;
    const antes = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = doMeio.offsetLeft - inicio.offsetLeft;
    el.style.scrollBehavior = antes;
    capasCedo.current = false;
    updateArrows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping, copias]);

  useEffect(
    () => () => {
      if (parouTimer.current) clearTimeout(parouTimer.current);
    },
    [],
  );

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
      <header data-giro="item" className="mb-3 flex items-end justify-between gap-4 px-3">
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
          updateArrows();
          pertoDaBorda();
          quandoParar();
        }}
        onPointerDown={carregarCapas}
        onTouchStart={() => {
          tocando.current = true;
          carregarCapas();
        }}
        onTouchEnd={() => {
          tocando.current = false;
          quandoParar();
        }}
        onTouchCancel={() => {
          tocando.current = false;
          quandoParar();
        }}
        className="no-scrollbar relative -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {looping ? (
          Array.from({ length: copias }, (_, i) => (
            // Só a do meio é lida por leitor de tela: as outras são eco.
            <div key={i} data-copia={i} aria-hidden={i !== meio || undefined} className="contents">
              {children}
            </div>
          ))
        ) : (
          <div data-copia={0} className="contents">
            {children}
          </div>
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
