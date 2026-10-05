/// <reference lib="dom" />
/**
 * INSTRUMENTOS DO ARNÊS `perf:g34` — injeção na página, coleta de rede por CDP,
 * estatística e gravação dos resultados. As specs só orquestram.
 *
 * Tudo que roda "dentro da página" fica em `instalarSonda`, instalada por
 * `addInitScript` ANTES do primeiro script do app: sem isso as tarefas longas
 * do boot (as que importam) passariam sem ser vistas.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';

export const PASTA = join(process.cwd(), '.g34');

// ── sonda na página ─────────────────────────────────────────────────────────
export function instalarSonda(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo roda no navegador
  const w = window as any;
  if (w.__g34) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = (w.__g34 = {
    fcp: 0,
    lcp: 0,
    lcpUrl: '',
    lcpTag: '',
    cls: 0,
    longtasks: [] as { s: number; d: number }[],
    eventos: [] as { n: string; s: number; d: number; atraso: number; id: number }[],
    loaf: [] as unknown[],
    viuEsqueleto: 0,
    semEsqueletoEm: 0,
    quadros: null as number[] | null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obs = (tipo: string, fn: (e: any) => void, extra: object = {}): void => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({
        type: tipo,
        buffered: true,
        ...extra,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } catch {
      /* tipo não suportado */
    }
  };
  obs('paint', (e) => {
    if (e.name === 'first-contentful-paint') m.fcp = e.startTime;
  });
  obs('largest-contentful-paint', (e) => {
    m.lcp = e.startTime;
    m.lcpUrl = e.url || '';
    m.lcpTag = e.element?.tagName ?? '';
  });
  obs('layout-shift', (e) => {
    if (!e.hadRecentInput) m.cls += e.value;
  });
  obs('longtask', (e) => {
    m.longtasks.push({ s: e.startTime, d: e.duration });
  });
  obs(
    'event',
    (e) => {
      m.eventos.push({
        n: e.name,
        s: e.startTime,
        d: e.duration,
        atraso: e.processingStart - e.startTime,
        id: e.interactionId || 0,
      });
    },
    { durationThreshold: 16 },
  );
  obs('long-animation-frame', (e) => {
    if (m.loaf.length > 400) return;
    m.loaf.push({
      s: e.startTime,
      d: e.duration,
      bloq: e.blockingDuration,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scripts: (e.scripts || []).slice(0, 6).map((s: any) => ({
        u: s.sourceURL,
        f: s.sourceFunctionName,
        c: s.sourceCharPosition,
        d: Math.round(s.duration),
        i: s.invokerType,
        inv: String(s.invoker || '').slice(0, 60),
      })),
    });
  });
  setInterval(() => {
    const sk = document.querySelector('main .skeleton');
    if (sk) m.viuEsqueleto = performance.now();
    else if (m.viuEsqueleto && !m.semEsqueletoEm) m.semEsqueletoEm = performance.now();
  }, 100);
  // Gravador de quadros: delta entre rAFs consecutivos.
  m.iniciarQuadros = (): void => {
    m.quadros = [];
    let ant = performance.now();
    const volta = (t: number): void => {
      if (!m.quadros) return;
      m.quadros.push(t - ant);
      ant = t;
      requestAnimationFrame(volta);
    };
    requestAnimationFrame(volta);
  };
  m.pararQuadros = (): number[] => {
    const q = m.quadros ?? [];
    m.quadros = null;
    return q;
  };
}

export interface LoAF {
  s: number;
  d: number;
  bloq: number;
  scripts: { u: string; f: string; c: number; d: number; i: string; inv: string }[];
}
export interface SondaPagina {
  fcp: number;
  lcp: number;
  lcpUrl: string;
  lcpTag: string;
  cls: number;
  longtasks: { s: number; d: number }[];
  eventos: { n: string; s: number; d: number; atraso: number; id: number }[];
  loaf: LoAF[];
  viuEsqueleto: number;
  semEsqueletoEm: number;
}

export async function lerSonda(page: Page): Promise<SondaPagina> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (window as any).__g34;
    return {
      fcp: m.fcp,
      lcp: m.lcp,
      lcpUrl: m.lcpUrl,
      lcpTag: m.lcpTag,
      cls: m.cls,
      longtasks: m.longtasks,
      eventos: m.eventos,
      loaf: m.loaf,
      viuEsqueleto: m.viuEsqueleto,
      semEsqueletoEm: m.semEsqueletoEm,
    };
  });
}

export async function memoriaEDom(
  page: Page,
): Promise<{ heapMb: number | null; nosDom: number; imgs: number }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = (performance as any).memory;
    return {
      heapMb: mem ? Math.round((mem.usedJSHeapSize / 1e6) * 10) / 10 : null,
      nosDom: document.getElementsByTagName('*').length,
      imgs: document.images.length,
    };
  });
}

// ── rede via CDP ────────────────────────────────────────────────────────────
interface Req {
  url: string;
  tipo: string;
  enc: number;
  doSW: boolean;
  cache: boolean;
  falhou: boolean;
  status: number;
}
export interface ResumoRede {
  requisicoes: number;
  falhas: number;
  jsKb: number;
  cssKb: number;
  fontesKb: number;
  imgKb: number;
  apiKb: number;
  docKb: number;
  totalKb: number;
  nJs: number;
  nImg: number;
  nApi: number;
  nExterno: number;
}
export class ColetorRede {
  private reqs = new Map<string, Req>();
  constructor(cdp: CDPSession) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Network.requestWillBeSent', (e: any) => {
      this.reqs.set(e.requestId, {
        url: e.request.url,
        tipo: e.type ?? 'Other',
        enc: 0,
        doSW: false,
        cache: false,
        falhou: false,
        status: 0,
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Network.responseReceived', (e: any) => {
      const r = this.reqs.get(e.requestId);
      if (!r) return;
      r.doSW = !!e.response.fromServiceWorker;
      r.cache = !!e.response.fromDiskCache;
      r.status = e.response.status;
      r.tipo = e.type ?? r.tipo;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Network.loadingFinished', (e: any) => {
      const r = this.reqs.get(e.requestId);
      if (r) r.enc = e.encodedDataLength;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdp.on('Network.loadingFailed', (e: any) => {
      const r = this.reqs.get(e.requestId);
      if (r) r.falhou = true;
    });
  }
  zerar(): void {
    this.reqs.clear();
  }
  lista(): Req[] {
    return [...this.reqs.values()];
  }
  /** Scripts e CSS carregados (nome → kB transferidos), do maior para o menor. */
  scripts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.lista()) {
      if (r.tipo !== 'Script' && r.tipo !== 'Stylesheet') continue;
      out[r.url.split('/').pop() ?? r.url] = Math.round(r.enc / 102.4) / 10;
    }
    return out;
  }
  /** Requisições por host (quem o app chama além da própria origem). */
  porHost(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.lista()) {
      let h = '?';
      try {
        h = new URL(r.url).host;
      } catch {
        /* url inválida */
      }
      out[h] = (out[h] ?? 0) + 1;
    }
    return out;
  }
  resumo(): ResumoRede {
    const L = this.lista();
    const soma = (f: (r: Req) => boolean): number =>
      Math.round(L.filter(f).reduce((a, r) => a + r.enc, 0) / 102.4) / 10;
    const app = (r: Req): boolean => r.url.startsWith('http://localhost');
    return {
      requisicoes: L.length,
      falhas: L.filter((r) => r.falhou).length,
      jsKb: soma((r) => r.tipo === 'Script'),
      cssKb: soma((r) => r.tipo === 'Stylesheet'),
      fontesKb: soma((r) => r.tipo === 'Font'),
      imgKb: soma((r) => r.tipo === 'Image'),
      apiKb: soma((r) => ['XHR', 'Fetch'].includes(r.tipo)),
      docKb: soma((r) => r.tipo === 'Document'),
      totalKb: soma(() => true),
      nJs: L.filter((r) => r.tipo === 'Script').length,
      nImg: L.filter((r) => r.tipo === 'Image').length,
      nApi: L.filter((r) => ['XHR', 'Fetch'].includes(r.tipo)).length,
      nExterno: L.filter((r) => !app(r)).length,
    };
  }
}

// ── estatística e saída ─────────────────────────────────────────────────────
export function mediana(v: number[]): number {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}
/** TBT: excedente de 50 ms de cada tarefa longa que começa entre `de` e `ate`. */
export function tbt(lts: { s: number; d: number }[], de: number, ate: number): number {
  return Math.round(
    lts.filter((t) => t.s >= de && t.s <= ate).reduce((a, t) => a + Math.max(0, t.d - 50), 0),
  );
}

export function gravar(grupo: string, linha: Record<string, unknown>): void {
  mkdirSync(PASTA, { recursive: true });
  appendFileSync(
    join(PASTA, `${grupo}.jsonl`),
    JSON.stringify({ ...linha, em: new Date().toISOString() }) + '\n',
  );
}
