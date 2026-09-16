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
import { audioEngine } from '@/lib/audio/AudioEngine';
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
  /** Do pedido até o motor receber a faixa (resolução de fonte no player). */
  ateMotor?: number;
  /** Do pedido até o elemento de áudio dizer que carregou. */
  ateCarregar?: number;
  /** De onde veio: blob (aparelho), importer (cofre), stream, outro. */
  fonte?: string;
  /** Houve troca de fonte (fallback) no meio? */
  cargas?: number;
}

interface QuadroLongo {
  duration: number;
  scripts?: {
    duration: number;
    invoker?: string;
    sourceFunctionName?: string;
    sourceURL?: string;
    sourceCharPosition?: number;
  }[];
}

const travamentos: { em: string; ms: number; rota: string; scripts: string[] }[] = [];

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

  // QUEM TRAVOU: Long Animation Frames diz a função e o arquivo, coisa que o
  // `longtask` não diz. Guarda os piores quadros da sessão.
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries() as unknown as QuadroLongo[]) {
        if (e.duration < 300) continue;
        const scripts = (e.scripts ?? [])
          .filter((sc) => sc.duration > 50)
          .sort((x, y) => y.duration - x.duration)
          .slice(0, 3)
          .map(
            (sc) =>
              `${Math.round(sc.duration)}ms ${sc.invoker ?? ''} ${sc.sourceFunctionName ?? ''} ${(sc.sourceURL ?? '').split('/').pop() ?? ''}:${sc.sourceCharPosition ?? ''}`,
          );
        travamentos.push({
          em: new Date().toISOString().slice(11, 19),
          ms: Math.round(e.duration),
          rota: location.pathname,
          scripts,
        });
        travamentos.sort((x, y) => y.ms - x.ms);
        if (travamentos.length > 8) travamentos.pop();
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    /* navegador sem LoAF */
  }

  window.addEventListener('error', (e) => anotarErro(String(e.message ?? 'erro')));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    anotarErro(`rejeição: ${r instanceof Error ? r.message : String(r)}`);
  });

  // LATÊNCIA DO PLAY, EM FASES: pedido → motor → carregado → som.
  let pedida: {
    id: string;
    t0: number;
    ateMotor?: number;
    ateCarregar?: number;
    fonte?: string;
    cargas: number;
  } | null = null;
  const carregarOriginal = audioEngine.load.bind(audioEngine);
  audioEngine.load = (track, options) => {
    if (pedida && pedida.id === track.id) {
      pedida.cargas += 1;
      pedida.ateMotor ??= Math.round(performance.now() - pedida.t0);
      const url = track.streamUrl ?? '';
      pedida.fonte = /^blob:/.test(url)
        ? 'blob'
        : /\/blob\//.test(url)
          ? 'cofre'
          : /\/stream/.test(url)
            ? 'stream'
            : url
              ? new URL(url, location.href).host.slice(0, 30)
              : 'local';
    }
    carregarOriginal(track, options);
  };
  audioEngine.on('loaded', () => {
    if (pedida && pedida.ateCarregar === undefined) {
      pedida.ateCarregar = Math.round(performance.now() - pedida.t0);
    }
  });
  usePlayerStore.subscribe((s, antes) => {
    const id = s.currentTrack?.id;
    if (id && id !== antes.currentTrack?.id && s.isPlaying) {
      pedida = { id, t0: performance.now(), cargas: 0 };
    }
    if (pedida && id === pedida.id && s.progress > 0 && antes.progress === 0) {
      plays.push({
        faixa: s.currentTrack?.title?.slice(0, 40) ?? id,
        ms: Math.round(performance.now() - pedida.t0),
        ateMotor: pedida.ateMotor,
        ateCarregar: pedida.ateCarregar,
        fonte: pedida.fonte,
        cargas: pedida.cargas,
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
    travamentos,
    erros,
    amostras,
    mortesSuspeitas,
    ultimaMorte,
  };
}
