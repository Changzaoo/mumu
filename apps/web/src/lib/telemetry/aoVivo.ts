/**
 * DIAGNÓSTICO AO VIVO — o que a telemetria não dizia quando o celular morria.
 *
 * O painel mostrava "jsHeapMb: 516" num aparelho de 4 GB, e nada sobre DE ONDE
 * vinham esses megabytes, se a aba já tinha sido morta antes, nem quanto tempo
 * um play levava para soar. Sem isso, cada conserto seria palpite. Este módulo
 * junta essas respostas num campo só (`aoVivo`) que vai em todo flush.
 *
 * Tudo aqui é leitura barata: contagens, não varreduras.
 */
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import { relatorio as relatorioDeAlcas } from '@/lib/perf/alcasDeBlob';
import { usePlayerStore } from '@/stores/playerStore';

const CHAVE_VIVO = 'aurial:aba-viva';

interface Amostra {
  em: string;
  heapMb: number | null;
  domNos: number;
  tarefasLongas: number;
  maiorTarefaMs: number;
}

interface Play {
  faixa: string;
  ms: number;
}

let instalado = false;
let tarefasLongas = 0;
let maiorTarefaMs = 0;
const plays: Play[] = [];
const erros: string[] = [];
const amostras: Amostra[] = [];
let mortesSuspeitas = 0;
let ultimaMorte: unknown = null;

let letrasEmCache: () => number = () => -1;
let vetores: () => number = () => -1;

function heapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof mem?.usedJSHeapSize === 'number' ? Math.round(mem.usedJSHeapSize / 1e6) : null;
}

function anotarErro(texto: string): void {
  erros.push(`${new Date().toISOString().slice(11, 19)} ${texto.slice(0, 160)}`);
  if (erros.length > 15) erros.shift();
}

export function instalarAoVivo(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;

  // A ABA FOI MORTA NA SESSÃO ANTERIOR? A marca é gravada a cada amostra e
  // apagada no `pagehide`. Se ela está lá no boot, a aba não saiu por conta
  // própria — o sistema matou (memória) ou o app travou.
  try {
    const anterior = localStorage.getItem(CHAVE_VIVO);
    if (anterior) {
      mortesSuspeitas = 1;
      ultimaMorte = JSON.parse(anterior);
    }
  } catch {
    /* armazenamento bloqueado */
  }
  window.addEventListener('pagehide', () => {
    try {
      localStorage.removeItem(CHAVE_VIVO);
    } catch {
      /* nada */
    }
  });

  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) {
        tarefasLongas++;
        maiorTarefaMs = Math.max(maiorTarefaMs, Math.round(e.duration));
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    /* sem longtask neste navegador */
  }

  window.addEventListener('error', (e) => anotarErro(String(e.message ?? 'erro')));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    anotarErro(`rejeição: ${r instanceof Error ? r.message : String(r)}`);
  });

  // LATÊNCIA DO PLAY: do pedido da faixa até o primeiro avanço de posição.
  let pedida: { id: string; t0: number } | null = null;
  usePlayerStore.subscribe((s, antes) => {
    const id = s.currentTrack?.id;
    if (id && id !== antes.currentTrack?.id && s.isPlaying) {
      pedida = { id, t0: performance.now() };
    }
    if (pedida && id === pedida.id && s.progress > 0 && antes.progress === 0) {
      plays.push({
        faixa: s.currentTrack?.title?.slice(0, 40) ?? id,
        ms: Math.round(performance.now() - pedida.t0),
      });
      if (plays.length > 12) plays.shift();
      pedida = null;
    }
  });

  void import('@/lib/lyrics/lyrics')
    .then((m) => {
      letrasEmCache = () => m.lyricsCacheEntries().length;
    })
    .catch(() => undefined);
  void import('@/lib/reco/embeddings')
    .then((m) => {
      vetores = () => m.vectorCount();
    })
    .catch(() => undefined);

  setInterval(amostrar, 60_000);
  amostrar();
}

function amostrar(): void {
  const a: Amostra = {
    em: new Date().toISOString().slice(11, 19),
    heapMb: heapMb(),
    domNos: document.getElementsByTagName('*').length,
    tarefasLongas,
    maiorTarefaMs,
  };
  tarefasLongas = 0;
  maiorTarefaMs = 0;
  amostras.push(a);
  if (amostras.length > 20) amostras.shift();
  try {
    localStorage.setItem(CHAVE_VIVO, JSON.stringify({ ...a, rota: location.pathname }));
  } catch {
    /* nada */
  }
}

export function coletarAoVivo(): Record<string, unknown> {
  let alcas: unknown = null;
  try {
    alcas = relatorioDeAlcas();
  } catch {
    /* nada */
  }
  return {
    build: import.meta.env.MODE,
    rota: location.pathname,
    heapMb: heapMb(),
    heapLimiteMb: Math.round(
      ((performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory
        ?.jsHeapSizeLimit ?? 0) / 1e6,
    ),
    domNos: document.getElementsByTagName('*').length,
    imagens: document.images.length,
    biblioteca: localLibrary.list().length,
    historico: localHistory.list().length,
    letrasEmCache: letrasEmCache(),
    vetores: vetores(),
    alcas,
    plays,
    erros,
    amostras,
    mortesSuspeitas,
    ultimaMorte,
  };
}
