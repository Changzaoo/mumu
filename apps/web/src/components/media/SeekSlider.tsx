import { useState } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { formatTime, cn } from '@/lib/utils';

export interface SeekSliderProps {
  /** Seconds. */
  value: number;
  /** Seconds. */
  duration: number;
  /** Buffered seconds (underlay). */
  buffered?: number;
  onSeek: (seconds: number) => void;
  showTimes?: boolean;
  className?: string;
}

/**
 * Player seek bar: 4px track, buffered underlay, drag preview,
 * mono tabular timestamps (DESIGN §7/§8).
 */
export function SeekSlider({
  value,
  duration,
  buffered = 0,
  onSeek,
  showTimes = true,
  className,
}: SeekSliderProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  // Duração pode chegar atrasada em alguns streams; enquanto isso, não podemos
  // truncar o relógio em 0:01.
  const max = Math.max(duration, value + 1, 1);
  const shown = dragValue ?? Math.max(0, value);
  const bufferedPct = Math.min(100, (buffered / max) * 100);

  return (
    <div className={cn('flex w-full items-center gap-2', className)}>
      {showTimes && (
        <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg-muted">
          {formatTime(shown)}
        </span>
      )}
      <SliderPrimitive.Root
        aria-label="Posição da faixa"
        value={[shown]}
        max={max}
        step={1}
        onValueChange={([v]) => setDragValue(v ?? 0)}
        onValueCommit={([v]) => {
          setDragValue(null);
          onSeek(v ?? 0);
        }}
        className="group/seek relative flex h-4 w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-fg/15">
          {/* buffered underlay */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-fg/15"
            style={{ width: `${bufferedPct}%` }}
          />
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-fg transition-colors duration-200 group-hover/seek:bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'block size-3 rounded-full bg-fg opacity-0 shadow-sm transition-opacity duration-200',
            'group-hover/seek:opacity-100 focus-visible:opacity-100 data-[state=active]:opacity-100',
          )}
        />
      </SliderPrimitive.Root>
      {showTimes && (
        <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
          {formatTime(duration)}
        </span>
      )}
    </div>
  );
}
