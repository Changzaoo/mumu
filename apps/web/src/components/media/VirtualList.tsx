import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollContainer } from '@/app/layout/scroll-context';
import { cn } from '@/lib/utils';

export interface VirtualListProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Row height estimate in px (TrackRow = 56). */
  estimateSize?: number;
  overscan?: number;
  className?: string;
  /**
   * Linhas de altura variável (barra de progresso que aparece, cartão que quebra
   * em duas linhas): cada linha é medida depois de montada. Sem isto a altura é
   * a estimativa, fixa — o comportamento das listas de faixas.
   */
  dynamic?: boolean;
}

/**
 * Virtualized vertical list for >50 rows (ARCHITECTURE §9).
 * Uses the AppShell scroll container from context when available (page lists),
 * otherwise falls back to its own scrollable box.
 *
 *   <VirtualList items={tracks} renderItem={(t, i) => <TrackRow …/>} />
 */
export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 56,
  overscan = 12,
  className,
  dynamic = false,
}: VirtualListProps<T>) {
  const shellScroller = useScrollContainer();
  const localRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A distância do topo da área rolável até esta lista. Lida a cada render (e
  // não só na montagem): numa página com conteúdo acima que cresce — pares que
  // chegam, outra lista — a margem velha desenhava a janela errada.
  const [margem, setMargem] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sem deps de propósito: lê o layout a cada render
  useLayoutEffect(() => {
    const atual = shellScroller ? (listRef.current?.offsetTop ?? 0) : 0;
    setMargem((m) => (m === atual ? m : atual));
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => shellScroller ?? localRef.current,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: shellScroller ? margem : 0,
  });

  const body = (
    <div
      ref={listRef}
      role="list"
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (item === undefined) return null;
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={dynamic ? virtualizer.measureElement : undefined}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {renderItem(item, row.index)}
          </div>
        );
      })}
    </div>
  );

  if (shellScroller) {
    return <div className={className}>{body}</div>;
  }
  return (
    <div ref={localRef} className={cn('h-full overflow-y-auto', className)}>
      {body}
    </div>
  );
}
