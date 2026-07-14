/**
 * Web Vitals sem dependências — mede LCP, CLS, INP (aproximado) e TTFB usando
 * só PerformanceObserver e a Navigation Timing API nativas.
 * Tudo best-effort: em browsers sem suporte nenhum observador sobe erro e o
 * campo correspondente simplesmente fica ausente no snapshot.
 * Cuidado ao editar comentários de bloco aqui: nunca escreva a sequência
 * asterisco+barra dentro deles (quebra o parser) — escreva por extenso.
 */

export interface VitalsSnapshot {
  lcpMs?: number;
  cls?: number;
  inpMs?: number;
  ttfbMs?: number;
}

let initialized = false;
let lcpMs: number | undefined;
let cls: number | undefined;
let inpMs: number | undefined;

/** Entrada de 'layout-shift' (não tipada no lib.dom padrão). */
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/** Cria um PerformanceObserver para um tipo; silencioso se não suportado. */
function observe(
  type: string,
  callback: (entries: PerformanceEntry[]) => void,
  extra?: Record<string, unknown>,
): void {
  try {
    const observer = new PerformanceObserver((list) => {
      try {
        callback(list.getEntries());
      } catch {
        /* nunca deixa um erro de medição vazar */
      }
    });
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    /* tipo não suportado neste browser — segue sem o campo */
  }
}

/** Liga os observadores uma única vez (chamado no start() da telemetria). */
export function initVitals(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    // LCP — o último candidato observado é o valor que vale.
    observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) lcpMs = Math.round(last.startTime);
    });

    // CLS — soma dos deslocamentos de layout sem input recente do usuário.
    observe('layout-shift', (entries) => {
      for (const entry of entries as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput && typeof entry.value === 'number') {
          cls = (cls ?? 0) + entry.value;
        }
      }
    });

    // INP (aproximação) — maior duração de interação vista na sessão.
    observe(
      'event',
      (entries) => {
        for (const entry of entries) {
          if (inpMs === undefined || entry.duration > inpMs) {
            inpMs = Math.round(entry.duration);
          }
        }
      },
      { durationThreshold: 40 },
    );
  } catch {
    /* best-effort */
  }
}

/** TTFB da navegação atual, ou undefined quando indisponível. */
function ttfbMs(): number | undefined {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (nav && typeof nav.responseStart === 'number' && nav.responseStart > 0) {
      return Math.round(nav.responseStart);
    }
  } catch {
    /* sem Navigation Timing */
  }
  return undefined;
}

/** Snapshot atual — só inclui os campos que de fato foram medidos. */
export function getVitals(): VitalsSnapshot {
  const out: VitalsSnapshot = {};
  try {
    if (lcpMs !== undefined) out.lcpMs = lcpMs;
    if (cls !== undefined) out.cls = Math.round(cls * 1000) / 1000;
    if (inpMs !== undefined) out.inpMs = inpMs;
    const ttfb = ttfbMs();
    if (ttfb !== undefined) out.ttfbMs = ttfb;
  } catch {
    /* nunca propaga */
  }
  return out;
}
