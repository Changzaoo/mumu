import { useEffect, useState } from 'react';

/** url → resolved `rgb(r, g, b)` (module-level cache, computed once per image). */
const colorCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function computeAverageColor(url: string): Promise<string | null> {
  const existing = pending.get(url);
  if (existing) return existing;

  const promise = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 24; // tiny sample is enough for an ambient glow
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] ?? 0;
          if (alpha < 128) continue;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          count++;
        }
        if (count === 0) return resolve(null);
        const color = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
        colorCache.set(url, color);
        resolve(color);
      } catch {
        resolve(null); // canvas tainted (no CORS) — caller falls back to accent
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).finally(() => pending.delete(url));

  pending.set(url, promise);
  return promise;
}

/**
 * Average color of an image for ambient glows (DESIGN §2 gradients).
 * Returns null while loading / on failure — fall back to the accent token.
 */
export function useDominantColor(imageUrl?: string | null): string | null {
  const [color, setColor] = useState<string | null>(() =>
    imageUrl ? (colorCache.get(imageUrl) ?? null) : null,
  );

  useEffect(() => {
    if (!imageUrl) {
      setColor(null);
      return;
    }
    const cached = colorCache.get(imageUrl);
    if (cached) {
      setColor(cached);
      return;
    }
    let cancelled = false;
    void computeAverageColor(imageUrl).then((result) => {
      if (!cancelled) setColor(result);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return color;
}
