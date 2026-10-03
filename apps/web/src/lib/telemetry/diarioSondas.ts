/**
 * AS SONDAS DO DIÁRIO — quem decide o que entra no caderno (`diario.ts`).
 *
 * Cada sonda ouve um canto do app e traduz o que vê em linhas curtas:
 *  • `app`      — boot, aba oculta/visível, rede on/off, saída da página;
 *  • `erro`     — erros de JavaScript e promessas rejeitadas sem dono;
 *  • `player`   — a store: faixa, play/pausa, fila, fase de carga, convite,
 *                 e o "som saiu" do ponto de vista dela (progresso > 0);
 *  • `motor`    — os eventos do motor de áudio (carregou, acabou, recusado,
 *                 falhou, buffering, interrompido, destravou) e o TRAVAMENTO:
 *                 store diz "tocando", posição não anda;
 *  • `audio`    — a SAÍDA DE VERDADE no computador: o analisador do grafo mede
 *                 o sinal; tempo andando com sinal zerado por alguns segundos é
 *                 'silencio' — exatamente o "passa o tempo e não toca", medido
 *                 em vez de relatado. E as mudanças de estado do AudioContext;
 *  • `rede`     — chamadas `fetch` que falharam, voltaram 4xx/5xx ou demoraram.
 *
 * Os detectores (silêncio e travamento) são classes PURAS, alimentadas por quem
 * tem o relógio — dá para testar sem navegador. Tudo é best-effort e
 * idempotente: instalar duas vezes não dobra nada, e uma sonda que falhe ao
 * instalar não impede as outras.
 */
import type { TrackDto } from '@radinho/shared';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { usePlayerStore } from '@/stores/playerStore';
import { anotar } from './diario';

// ── Detectores puros ──────────────────────────────────────────────────

/** Desvio máximo do sinal em relação ao silêncio (128 no domínio do tempo). */
export function nivelDoSinal(amostras: Uint8Array): number {
  let maior = 0;
  for (let i = 0; i < amostras.length; i++) {
    const desvio = Math.abs((amostras[i] ?? 128) - 128);
    if (desvio > maior) maior = desvio;
  }
  return maior;
}

/** Abaixo disto o sinal é silêncio (ruído de quantização fica em 0–1). */
export const LIMIAR_DE_SILENCIO = 2;
/** Tempo andando sem sinal por tanto: é silêncio de verdade, não um respiro. */
export const PRAZO_DE_SILENCIO_MS = 6_000;

export type VeredictoDeSilencio = 'silencio' | 'somVoltou' | null;

/**
 * "O tempo anda e não sai som" — medido. Só conta enquanto a posição AVANÇA:
 * pausado, carregando ou parado, não há o que medir. Avisa UMA vez por
 * episódio e avisa quando o som volta.
 */
export class DetectorDeSilencio {
  private desde: number | null = null;
  private posAnterior = -1;
  private emSilencio = false;

  avaliar(leitura: {
    tocando: boolean;
    posicao: number;
    nivel: number;
    agora: number;
  }): VeredictoDeSilencio {
    const { tocando, posicao, nivel, agora } = leitura;
    const andou = this.posAnterior >= 0 && posicao > this.posAnterior + 0.2;
    this.posAnterior = posicao;
    if (!tocando || !andou) {
      this.desde = null;
      return null;
    }
    if (nivel >= LIMIAR_DE_SILENCIO) {
      this.desde = null;
      if (this.emSilencio) {
        this.emSilencio = false;
        return 'somVoltou';
      }
      return null;
    }
    this.desde ??= agora;
    if (!this.emSilencio && agora - this.desde >= PRAZO_DE_SILENCIO_MS) {
      this.emSilencio = true;
      return 'silencio';
    }
    return null;
  }

  /** Trocou de faixa: o episódio recomeça do zero. */
  reiniciar(): void {
    this.desde = null;
    this.posAnterior = -1;
    this.emSilencio = false;
  }
}

/** A store diz "tocando" e a posição não anda há tanto: travou. */
export const PRAZO_DE_TRAVAMENTO_MS = 8_000;

export type VeredictoDeTravamento = 'travou' | 'destravou' | null;

export class DetectorDeTravamento {
  private paradoDesde: number | null = null;
  private posAnterior = -1;
  private travado = false;

  avaliar(leitura: {
    tocando: boolean;
    esperando: boolean;
    posicao: number;
    agora: number;
  }): VeredictoDeTravamento {
    const { tocando, esperando, posicao, agora } = leitura;
    const andou = this.posAnterior < 0 || posicao > this.posAnterior + 0.05;
    this.posAnterior = posicao;
    // Esperando rede/carga é espera declarada, não travamento silencioso.
    if (!tocando || esperando) {
      this.paradoDesde = null;
      return null;
    }
    if (andou) {
      this.paradoDesde = null;
      if (this.travado) {
        this.travado = false;
        return 'destravou';
      }
      return null;
    }
    this.paradoDesde ??= agora;
    if (!this.travado && agora - this.paradoDesde >= PRAZO_DE_TRAVAMENTO_MS) {
      this.travado = true;
      return 'travou';
    }
    return null;
  }

  reiniciar(): void {
    this.paradoDesde = null;
    this.posAnterior = -1;
    this.travado = false;
  }
}

// ── Rótulos curtos ────────────────────────────────────────────────────

/** De onde a faixa toca: aparelho (blob), cofre, stream da API ou o host de fora. */
export function fonteDaFaixa(track: TrackDto | null | undefined): string | null {
  const url = track?.streamUrl ?? '';
  if (!url) return null;
  if (/^blob:/.test(url)) return 'aparelho';
  if (/\/blob\//.test(url)) return 'cofre';
  if (/\/stream/.test(url)) return 'stream';
  try {
    return new URL(url, typeof location !== 'undefined' ? location.href : 'http://x/').host.slice(
      0,
      30,
    );
  } catch {
    return null;
  }
}

export function descreverFaixa(track: TrackDto | null | undefined): string {
  if (!track) return '(nenhuma)';
  const artista = track.artists?.[0]?.name;
  const fonte = fonteDaFaixa(track);
  return [track.title, artista, fonte ? `[${fonte}]` : null].filter(Boolean).join(' · ');
}

/** "host/caminho" sem query nem token: identifica a chamada sem vazar nada. */
export function rotuloDaUrl(entrada: unknown): string {
  try {
    const bruto =
      typeof entrada === 'string'
        ? entrada
        : entrada instanceof URL
          ? entrada.href
          : ((entrada as { url?: string })?.url ?? '');
    const url = new URL(bruto, typeof location !== 'undefined' ? location.href : 'http://x/');
    const caminho = url.pathname.length > 40 ? `${url.pathname.slice(0, 39)}…` : url.pathname;
    return `${url.host}${caminho}`;
  } catch {
    return String(entrada).slice(0, 50);
  }
}

// ── As sondas ─────────────────────────────────────────────────────────

let instalado = false;
/** Chamadas que não entram no diário: a própria telemetria (loop) e sondas. */
const IGNORAR_NA_REDE = /\/telemetria\//;
/** Acima disto, uma chamada bem-sucedida ainda ganha linha: 'lenta'. */
const REDE_LENTA_MS = 8_000;

function seguro(nome: string, instalar: () => void): void {
  try {
    instalar();
  } catch (erro) {
    anotar('erro', 'sonda', `${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

function sondaDoApp(): void {
  const conexao = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  anotar('app', 'boot', {
    build: import.meta.env.MODE,
    rota: location.pathname,
    online: navigator.onLine,
    rede: conexao?.effectiveType,
    instalado: window.matchMedia?.('(display-mode: standalone)').matches || undefined,
  });
  document.addEventListener('visibilitychange', () => {
    anotar('app', document.hidden ? 'oculta' : 'visivel');
  });
  window.addEventListener('online', () => anotar('app', 'online'));
  window.addEventListener('offline', () => anotar('app', 'offline'));
  window.addEventListener('pagehide', () => anotar('app', 'saiu'));
  if (conexao) {
    (conexao as unknown as EventTarget).addEventListener?.('change', () =>
      anotar('app', 'rede', conexao.effectiveType),
    );
  }
}

function sondaDeErros(): void {
  window.addEventListener('error', (e) => {
    const onde = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : '';
    anotar('erro', 'erro', `${e.message ?? 'erro'}${onde}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    anotar('erro', 'rejeicao', r instanceof Error ? r.message : String(r));
  });
}

function sondaDoPlayer(): void {
  let faixaDesdeMs: number | null = null;
  let somSaiuDaFaixa: string | null = null;
  usePlayerStore.subscribe((s, antes) => {
    const faixa = s.currentTrack;
    if (faixa?.id !== antes.currentTrack?.id) {
      anotar('player', 'faixa', {
        de: antes.currentTrack?.title,
        para: descreverFaixa(faixa),
        ctx: s.context?.source,
      });
      faixaDesdeMs = performance.now();
      somSaiuDaFaixa = null;
    }
    if (s.isPlaying !== antes.isPlaying) anotar('player', s.isPlaying ? 'play' : 'pausa');
    if (s.isBuffering !== antes.isBuffering) {
      anotar('player', 'buffer', s.isBuffering ? 'esperando' : 'ok');
    }
    const fase = s.carga
      ? `${s.carga.fase}${s.carga.tentativa ? ` ${s.carga.tentativa}/${s.carga.total ?? '?'}` : ''}`
      : null;
    const faseAntes = antes.carga
      ? `${antes.carga.fase}${antes.carga.tentativa ? ` ${antes.carga.tentativa}/${antes.carga.total ?? '?'}` : ''}`
      : null;
    if (fase !== faseAntes) anotar('player', 'carga', fase ?? 'pronta');
    if (s.resumeInvite && !antes.resumeInvite) anotar('player', 'convite', 'toque para continuar');
    if (s.queue.length !== antes.queue.length) {
      anotar('player', 'fila', `${s.queue.length} faixas, posição ${s.queueIndex + 1}`);
    }
    if (s.repeat !== antes.repeat || s.shuffle !== antes.shuffle) {
      anotar('player', 'modo', `repetir=${s.repeat} aleatório=${s.shuffle ? 'sim' : 'não'}`);
    }
    // O som saiu, do ponto de vista da store: o progresso deixou o zero.
    if (faixa && s.progress > 0 && antes.progress === 0 && somSaiuDaFaixa !== faixa.id) {
      somSaiuDaFaixa = faixa.id;
      const ms = faixaDesdeMs !== null ? Math.round(performance.now() - faixaDesdeMs) : undefined;
      anotar('player', 'som', ms !== undefined ? `${ms} ms depois da troca` : undefined);
    }
  });
}

function sondaDoMotor(): void {
  audioEngine.on('loaded', ({ track, duration }) => {
    anotar('motor', 'carregou', `${track.title} · ${Math.round(duration)}s`);
  });
  audioEngine.on('ended', ({ track }) => anotar('motor', 'acabou', track?.title));
  audioEngine.on('error', ({ message, track, kind }) => {
    anotar(
      'motor',
      kind === 'play' ? 'recusado' : 'falhou',
      `${kind}: ${message} (${track?.title ?? '?'})`,
    );
  });
  audioEngine.on('buffering', ({ buffering }) => {
    anotar('motor', 'buffer', buffering ? 'esperando dados' : 'ok');
  });
  audioEngine.on('interrupted', ({ track }) => anotar('motor', 'interrompido', track?.title));
  audioEngine.on('unlocked', ({ track }) => anotar('motor', 'destravou', track?.title));

  // TRAVAMENTO E SILÊNCIO, uma leitura por segundo enquanto a store diz que toca.
  const travamento = new DetectorDeTravamento();
  const silencio = new DetectorDeSilencio();
  let faixaMedida: string | undefined;
  let amostras: Uint8Array<ArrayBuffer> | null = null;
  let estadoDoContexto: string | null = null;
  setInterval(() => {
    const s = usePlayerStore.getState();
    if (s.currentTrack?.id !== faixaMedida) {
      faixaMedida = s.currentTrack?.id;
      travamento.reiniciar();
      silencio.reiniciar();
    }
    const agora = Date.now();
    const posicao = audioEngine.getPosition();
    const veredictoT = travamento.avaliar({
      tocando: s.isPlaying,
      esperando: s.isBuffering || s.carga !== null,
      posicao,
      agora,
    });
    if (veredictoT) {
      anotar('motor', veredictoT, `${s.currentTrack?.title ?? '?'} em ${Math.round(posicao)}s`);
    }

    // A SAÍDA DE VERDADE (só onde há grafo: computador).
    const analisador = audioEngine.analyser;
    if (!analisador) return;
    const estado = String(analisador.context.state);
    if (estado !== estadoDoContexto) {
      // O primeiro estado não é notícia; as mudanças são.
      if (estadoDoContexto !== null) anotar('audio', 'contexto', estado);
      estadoDoContexto = estado;
    }
    if (!s.isPlaying) return;
    if (!amostras || amostras.length !== analisador.fftSize) {
      amostras = new Uint8Array(new ArrayBuffer(analisador.fftSize));
    }
    analisador.getByteTimeDomainData(amostras);
    const veredictoS = silencio.avaliar({
      tocando: s.isPlaying,
      posicao,
      nivel: nivelDoSinal(amostras),
      agora,
    });
    if (veredictoS) {
      anotar(
        'audio',
        veredictoS,
        `${s.currentTrack?.title ?? '?'} em ${Math.round(posicao)}s · contexto ${estado} · vol ${Math.round(s.volume * 100)}${s.muted ? ' mudo' : ''}`,
      );
    }
  }, 1_000);
}

function sondaDaRede(): void {
  const marca = window as unknown as { __diarioFetch?: true };
  if (marca.__diarioFetch || typeof window.fetch !== 'function') return;
  marca.__diarioFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rotulo = rotuloDaUrl(entrada);
    const metodo = (init?.method ?? (entrada as Request)?.method ?? 'GET').toUpperCase();
    const t0 = performance.now();
    const vigiar = !IGNORAR_NA_REDE.test(rotulo);
    try {
      const resposta = await original(entrada, init);
      if (vigiar) {
        const ms = Math.round(performance.now() - t0);
        if (resposta.status >= 400)
          anotar('rede', 'http', `${resposta.status} ${metodo} ${rotulo}`);
        else if (ms > REDE_LENTA_MS) anotar('rede', 'lenta', `${ms} ms ${metodo} ${rotulo}`);
      }
      return resposta;
    } catch (erro) {
      if (vigiar) {
        const nome = erro instanceof Error ? erro.name : 'erro';
        // Abort é cancelamento nosso (troca de página, de faixa): não é falha.
        if (nome !== 'AbortError') {
          anotar(
            'rede',
            'falhou',
            `${metodo} ${rotulo} ${erro instanceof Error ? erro.message : String(erro)}`,
          );
        }
      }
      throw erro;
    }
  };
}

/** Liga todas as sondas, uma vez. Chamado pela telemetria no boot. */
export function instalarSondasDoDiario(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  seguro('app', sondaDoApp);
  seguro('erros', sondaDeErros);
  seguro('player', sondaDoPlayer);
  seguro('motor', sondaDoMotor);
  seguro('rede', sondaDaRede);
}
