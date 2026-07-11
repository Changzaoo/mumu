import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { cn } from '@/lib/utils';

export interface WaveformSeekerProps {
  /** Normalized 0..1 peaks (API: GET /tracks/:id/waveform). */
  peaks: readonly number[];
  /** Seconds. */
  duration: number;
  onSeek: (seconds: number) => void;
  className?: string;
}

function readToken(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : '#17E68C';
}

/**
 * Canvas waveform seek bar (NowPlaying). Reads the playhead straight from the
 * engine every frame for 60fps without store churn. Keyboard: slider role,
 * ←/→ = ±5s.
 */
export function WaveformSeeker({ peaks, duration, onSeek, className }: WaveformSeekerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<number | null>(null); // 0..1 pointer preview

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = (): void => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const accent = readToken('--accent');
    const rest = readToken('--fg');

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      if (width === 0) return;
      ctx.clearRect(0, 0, width, height);

      const progress = duration > 0 ? Math.min(1, audioEngine.getPosition() / duration) : 0;
      const preview = hoverRef.current;

      const barGap = 1;
      const barCount = Math.min(peaks.length, Math.floor(width / 3));
      const barWidth = (width - (barCount - 1) * barGap) / barCount;
      const step = peaks.length / barCount;
      const mid = height / 2;

      for (let i = 0; i < barCount; i++) {
        const peak = peaks[Math.min(peaks.length - 1, Math.floor(i * step))] ?? 0;
        const barHeight = Math.max(2, peak * height * 0.92);
        const x = i * (barWidth + barGap);
        const fraction = (i + 0.5) / barCount;
        const played = fraction <= progress;
        const previewed = preview !== null && fraction <= preview;
        ctx.globalAlpha = played ? 1 : previewed ? 0.6 : 0.25;
        ctx.fillStyle = played || previewed ? accent : rest;
        // Rounded vertical bar centered on the midline.
        const radius = Math.min(barWidth / 2, 2);
        ctx.beginPath();
        ctx.roundRect(x, mid - barHeight / 2, barWidth, barHeight, radius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [peaks, duration]);

  const fractionFromEvent = (event: PointerEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.min(duration, audioEngine.getPosition() + 5));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onSeek(Math.max(0, audioEngine.getPosition() - 5));
    }
  };

  return (
    <canvas
      ref={canvasRef}
      role="slider"
      aria-label="Posição da faixa"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(audioEngine.getPosition())}
      tabIndex={0}
      onPointerMove={(event) => {
        hoverRef.current = fractionFromEvent(event);
      }}
      onPointerLeave={() => {
        hoverRef.current = null;
      }}
      onPointerDown={(event) => {
        onSeek(fractionFromEvent(event) * duration);
      }}
      onKeyDown={handleKeyDown}
      className={cn('h-16 w-full cursor-pointer touch-none', className)}
    />
  );
}
