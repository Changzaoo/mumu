import { useEffect, useRef } from 'react';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { usePlayerStore } from '@/stores/playerStore';
import { cn } from '@/lib/utils';

export interface SpectrumVisualizerProps {
  className?: string;
  barCount?: number;
}

function readToken(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : '#17E68C';
}

/**
 * Frequency bars fed by AudioEngine.analyser — accent gradient, 60fps rAF,
 * pauses when the tab is hidden or playback stops. Renders a calm idle
 * baseline when Web Audio is unavailable.
 */
export function SpectrumVisualizer({ className, barCount = 56 }: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const analyser = audioEngine.analyser;
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      if (width === 0 || document.hidden) return;
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, `${accent.slice(0, -1)} / 0.25)`);
      ctx.fillStyle = gradient;

      const gap = 2;
      const barWidth = (width - (barCount - 1) * gap) / barCount;

      if (analyser && bins && isPlaying) {
        analyser.getByteFrequencyData(bins);
        // Log-ish sampling: musical energy lives in the lower bins.
        const usable = Math.floor(bins.length * 0.7);
        for (let i = 0; i < barCount; i++) {
          const t = i / barCount;
          const bin = Math.floor(t * t * usable);
          const value = (bins[bin] ?? 0) / 255;
          const barHeight = Math.max(2, value * height * 0.95);
          const x = i * (barWidth + gap);
          ctx.beginPath();
          ctx.roundRect(x, height - barHeight, barWidth, barHeight, Math.min(barWidth / 2, 2));
          ctx.fill();
        }
      } else {
        // Idle baseline.
        ctx.globalAlpha = 0.3;
        for (let i = 0; i < barCount; i++) {
          const x = i * (barWidth + gap);
          ctx.beginPath();
          ctx.roundRect(x, height - 3, barWidth, 3, 1.5);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [barCount, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none size-full', className)}
    />
  );
}
