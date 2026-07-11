import { useMemo } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, ListMusic, Music, X } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

interface QueueEntry {
  /** Stable-ish key: same track may repeat in a queue. */
  key: string;
  track: TrackDto;
  /** Absolute index in playerStore.queue. */
  queueIndex: number;
}

function QueueRow({
  entry,
  active = false,
  onRemove,
}: {
  entry: QueueEntry;
  active?: boolean;
  onRemove?: () => void;
}) {
  const playAt = usePlayerStore((s) => s.playAt);
  return (
    <div className="group flex h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 transition-colors duration-200 hover:bg-fg/5">
      <button
        type="button"
        aria-label={`Tocar ${entry.track.title}`}
        onClick={() => playAt(entry.queueIndex)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-fg/6">
          {entry.track.coverUrl ? (
            <img
              src={entry.track.coverUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center text-fg-subtle">
              <Music className="size-4" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span
            className={cn('line-clamp-1 text-sm font-medium', active ? 'text-accent' : 'text-fg')}
          >
            {entry.track.title}
          </span>
          <span className="line-clamp-1 text-[13px] text-fg-muted">
            {trackArtistNames(entry.track)}
          </span>
        </span>
      </button>
      {onRemove && (
        <IconButton
          aria-label={`Remover ${entry.track.title} da fila`}
          size="sm"
          onClick={onRemove}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}

function DraggableQueueRow({ entry, onRemove }: { entry: QueueEntry; onRemove: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={entry}
      dragListener={false}
      dragControls={controls}
      className="flex items-center"
    >
      <button
        type="button"
        aria-label={`Arrastar ${entry.track.title}`}
        onPointerDown={(event) => controls.start(event)}
        className="grid size-8 shrink-0 cursor-grab place-items-center text-fg-subtle transition-colors hover:text-fg active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <QueueRow entry={entry} onRemove={onRemove} />
    </Reorder.Item>
  );
}

/**
 * Right queue panel (DESIGN §7): 320px glass column. "Tocando agora" +
 * draggable "A seguir" (framer-motion Reorder → playerStore.setUpNext).
 */
export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const setUpNext = usePlayerStore((s) => s.setUpNext);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setQueueOpen = useUiStore((s) => s.setQueueOpen);

  const upNext = useMemo<QueueEntry[]>(
    () =>
      queue.slice(queueIndex + 1).map((track, offset) => ({
        key: `${track.id}:${queueIndex + 1 + offset}`,
        track,
        queueIndex: queueIndex + 1 + offset,
      })),
    [queue, queueIndex],
  );

  return (
    <aside
      aria-label="Fila de reprodução"
      className="glass hidden w-80 shrink-0 flex-col rounded-none border-y-0 border-r-0 lg:flex"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="text-sm font-semibold tracking-tight text-fg">Fila</h2>
        <div className="flex items-center gap-1">
          {upNext.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearQueue}>
              Limpar
            </Button>
          )}
          <IconButton aria-label="Fechar fila" size="sm" onClick={() => setQueueOpen(false)}>
            <X />
          </IconButton>
        </div>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {currentTrack ? (
          <>
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
              Tocando agora
            </p>
            <QueueRow entry={{ key: 'current', track: currentTrack, queueIndex }} active />

            {upNext.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  A seguir
                </p>
                <Reorder.Group
                  axis="y"
                  values={upNext}
                  onReorder={(entries: QueueEntry[]) => setUpNext(entries.map((e) => e.track))}
                  className="space-y-0.5"
                >
                  {upNext.map((entry) => (
                    <DraggableQueueRow
                      key={entry.key}
                      entry={entry}
                      onRemove={() => removeFromQueue(entry.queueIndex)}
                    />
                  ))}
                </Reorder.Group>
              </>
            )}
          </>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="Fila vazia"
            description="Toque algo para começar a montar sua fila."
          />
        )}
      </div>
    </aside>
  );
}
