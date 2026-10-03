/**
 * AudioEngine — singleton playback engine (ARCHITECTURE.md §10).
 *
 * Howler (html5 streaming) + Web Audio graph:
 *
 *   slot.mediaSource ─▶ trim (ReplayGain) ─▶ fade (crossfade) ─┐
 *   slot.mediaSource ─▶ trim ─────────────▶ fade ──────────────┤
 *                                                              ▼
 *                            eqInput ─▶ 10× BiquadFilter (peaking, EQ_BANDS_HZ)
 *                                   ─▶ master (volume, smooth ramps)
 *                                   ─▶ analyser (spectrum/visualizer)
 *                                   ─▶ destination
 *
 * - Dual slots enable gapless preload (`preloadNext`) and N-second crossfades.
 * - ReplayGain: per-slot trim GainNode from track.loudnessLufs → −14 LUFS target.
 * - HLS (.m3u8): native <audio> on Safari, hls.js elsewhere (lazy-imported).
 * - Web Audio requires CORS-clean audio (`crossOrigin=anonymous` + ACAO headers
 *   from the API/R2). If the graph cannot be built, playback still works —
 *   EQ/visualizer simply disable themselves.
 *
 * Typed events (`on`) are consumed exclusively by `stores/playerStore.ts`.
 */
import { Howl, Howler } from 'howler';
import { EQ_BANDS_HZ, dbToLinear, replayGainDb, type TrackDto } from '@radinho/shared';
import { resolveMediaUrl } from '@/lib/api';
import { clamp } from '@/lib/utils';
import type HlsType from 'hls.js';
import { anotarCorrecaoDeSaida, type MotivoDeCorrecao } from '@/lib/telemetry/avancoDeFaixa';

/**
 * Why an `error` event fired — the consumer decides what is retryable:
 * - 'source': the track has no resolvable source at all;
 * - 'load':   the chosen source failed to load/decode (dead URL, 404/403, CDN
 *             down) — trying an ALTERNATIVE source may succeed;
 * - 'play':   the browser blocked playback (autoplay policy) — the source is
 *             fine, only a user gesture is missing.
 */
export type PlaybackErrorKind = 'source' | 'load' | 'play';

export interface AudioEngineEventMap {
  /** Emitted at rAF rate while playing (throttle on the consumer side). */
  timeupdate: { position: number; duration: number };
  loaded: { track: TrackDto; duration: number };
  ended: { track: TrackDto | null };
  error: { message: string; track: TrackDto | null; kind: PlaybackErrorKind };
  buffering: { buffering: boolean };
  /**
   * O sistema pausou por fora: outro app pegou o áudio, chegou ligação, o
   * fone saiu. NÃO é o usuário apertando pause — e não é convite para voltar
   * a tocar. Quem ouve isto acerta o estado e fica quieto.
   */
  interrupted: { track: TrackDto | null };
  /**
   * Um `play()` que tinha sido bloqueado (autoplay) finalmente pegou, no
   * primeiro gesto do usuário depois do bloqueio — ver o `resume` em
   * `startSlot`. É a contraparte de `error{kind:'play'}`: aquele avisa que
   * parou; este avisa que, sem mais nada ter sido pedido, voltou sozinho.
   */
  unlocked: { track: TrackDto | null };
}

export interface LoadOptions {
  autoplay?: boolean;
  /** Crossfade duration in seconds (0 = hard cut / gapless). */
  crossfadeSeconds?: number;
}

type SlotSource =
  { kind: 'howl'; howl: Howl } | { kind: 'element'; el: HTMLAudioElement; hls: HlsType | null };

interface Slot {
  source: SlotSource | null;
  /** Underlying media element once known (Howler node or owned element). */
  el: HTMLAudioElement | null;
  track: TrackDto | null;
  /** A URL que este slot está tocando — é dela que o slot RENASCE (ver `renascer`). */
  url: string | null;
  /** Já renasceu nesta carga: o último recurso roda uma vez, nunca em laço. */
  renasceu: boolean;
  loaded: boolean;
  fade: GainNode | null;
  trim: GainNode | null;
  mediaSource: MediaElementAudioSourceNode | null;
  cleanup: Array<() => void>;
  /** Monotonic sequence guarding stale async callbacks after resets. */
  seq: number;
  /**
   * Posição de partida esperando o Howler carregar (ver `iniciarEm`). Com ela
   * pendente, o play também espera: sai só depois de posicionado.
   */
  inicioAoCarregar?: number | null;
  /**
   * Até quando (ms, relógio de parede) o ganho do fade PODE estar fora de 1 por
   * causa de uma rampa legítima. Depois disso, ganho < 1 num slot ativo que
   * toca é ganho preso — ver `garantirSaidaAudivel`.
   */
  fadeAte?: number;
  /**
   * A carga FALHOU enquanto o slot era o ocioso (pré-carregado). Os handlers de
   * erro só falam pelo slot ativo, então a falha se perdia: promovido a ativo,
   * o slot não tinha 'load' nem 'error' por vir — silêncio até o watchdog (ou
   * para sempre, nos caminhos de troca que não o armam). `load()` relê isto na
   * promoção e avisa a store na hora.
   */
  falhouAoCarregar?: boolean;
}

type SlotIndex = 0 | 1;

interface HowlInternals {
  _sounds: Array<{ _node?: HTMLAudioElement; _volume?: number }>;
  _volume?: number;
}

/** Elementos destravados mantidos no estoque do Howler (ver `abastecerEstoque`). */
const ESTOQUE_DESTRAVADO = 6;

interface HowlerInternals {
  _html5AudioPool?: HTMLAudioElement[];
  _canPlayEvent?: string;
}

// ── POR QUE A MÚSICA DEMORAVA TANTO PARA COMEÇAR ─────────────────
//
// O Howler decide "o som está pronto" ouvindo `canplaythrough`. Esse evento não
// significa "dá para começar": significa "o navegador estima que dá para tocar
// a faixa INTEIRA sem parar para carregar de novo". Em rede de celular isso é,
// na prática, esperar boa parte do arquivo baixar — e o `play()` que a gente
// chama no clique fica ENFILEIRADO atrás dele (ver `_playLock` no howler.js).
// Resultado: o dedo toca no play e o som só sai segundos depois, com o spinner
// girando à toa em cima de um áudio que já podia estar tocando.
//
// `canplay` é o evento certo: dispara em readyState 3 (HAVE_FUTURE_DATA) — há
// dados suficientes para começar AGORA e continuar carregando durante a
// reprodução, que é exatamente como um player de streaming deve se comportar.
// Se a rede não acompanhar, o elemento emite 'waiting' e o spinner aparece aí,
// no momento certo — esse caminho já existe em `attachBufferingEvents`.
//
// Trocado no objeto global do Howler porque é de lá que tanto o carregamento
// quanto o `play()` pendurado leem o nome do evento.
(Howler as unknown as HowlerInternals)._canPlayEvent = 'canplay';

/** createMediaElementSource is once-per-element; Howler pools elements. */
const mediaSourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * NO CELULAR O SOM SAI DIRETO DO ELEMENTO — sem passar pelo Web Audio.
 *
 * Esta é a regra que decide se a música continua tocando com a TELA APAGADA, e
 * ela custa caro: sem grafo não há equalizador, nem normalização de volume, nem
 * visualizador de espectro no celular. Vale mesmo assim, e o porquê é este:
 *
 * Um `<audio>` comum é tratado pelo sistema como MÍDIA: com a tela apagada ele
 * segue tocando, aparece no bloqueio e mantém a sessão viva. No instante em que
 * o elemento passa por `createMediaElementSource`, o som deixa de sair dele e
 * passa a sair do AudioContext — e o AudioContext é suspenso quando a página vai
 * para segundo plano. O resultado é exatamente o sintoma relatado: a faixa
 * seguinte começa, toca cerca de um segundo e emudece.
 *
 * ── POR QUE A MITIGAÇÃO ANTERIOR NÃO PODIA FUNCIONAR ──
 *
 * O caminho de antes mantinha o grafo no Android e tentava contornar com um
 * `setInterval` de 1s que chamava `ctx.resume()` (ver `syncTicker`). Mas o
 * próprio `playerStore` já documenta, no bloco do `handoffTimer`, que com a tela
 * apagada "o Android estrangula temporizador repetido — o heartbeat de 1s vira
 * um a cada minuto ou some". As duas afirmações não cabem juntas: o conserto
 * dependia justamente do relógio que o sistema desliga. Enquanto a tela está
 * acesa ele funciona, e foi por isso que a mitigação passou nos testes de quem a
 * escreveu — o problema só existe onde o instrumento não olhava.
 *
 * NÃO DÁ para religar o grafo só quando a tela acende: depois que um elemento
 * passa por `createMediaElementSource`, desconectar o nó não devolve o som ao
 * elemento — deixa MUDO. A escolha é por elemento e para sempre, e por isso ela
 * é feita por plataforma, aqui.
 *
 * O iPhone já seguia esta regra pelo mesmo motivo. O Android ficou de fora e o
 * sintoma sobreviveu — a mesma forma do vazamento de alças, que também tinha
 * duas cópias e só uma consertada.
 */
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Celular de qualquer marca. `userAgentData.mobile` é a resposta do próprio
 * navegador e vem primeiro; a regex cobre quem ainda não a implementa (todo o
 * Safari, e o Firefox até pouco tempo atrás).
 */
const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  ((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ===
    true ||
    IS_IOS ||
    /Android|Mobile|iP(hone|od|ad)|Silk|Kindle|Opera Mini|IEMobile/i.test(navigator.userAgent));

/** No celular a reprodução em segundo plano ganha do equalizador. Ver acima. */
const SEM_GRAFO_WEB_AUDIO = IS_MOBILE;

/**
 * O equalizador (e a normalização, e o visualizador) só existe onde há grafo.
 *
 * Exportado para a interface poder DIZER isso. Um controle que não faz nada é
 * pior que um controle ausente: a pessoa mexe, não ouve diferença e conclui que
 * o app está quebrado. No iPhone isso já acontecia calado desde que o grafo foi
 * desligado lá; agora que o Android entrou na mesma regra, a tela avisa.
 */
export const equalizadorDisponivel = !SEM_GRAFO_WEB_AUDIO;

const PLAYBACK_ERROR = 'Não foi possível reproduzir esta faixa.';

/** Teto para o slot de saída seguir vivo (mudo) esperando o novo pegar. */
const RETIRE_MAX_MS = 10_000;
const RETIRE_POLL_MS = 200;
/** Sinal zerado no analisador por tanto, com o tempo andando: o elemento renasce. */
const SILENCIO_ATE_RENASCER_MS = 6_000;
/** Abaixo disto (desvio de 128 no domínio do tempo) é silêncio digital. */
const LIMIAR_DE_SINAL = 2;

function createSlot(): Slot {
  return {
    url: null,
    renasceu: false,
    source: null,
    el: null,
    track: null,
    loaded: false,
    fade: null,
    trim: null,
    mediaSource: null,
    cleanup: [],
    seq: 0,
  };
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

/**
 * A REJEIÇÃO QUE NÃO É ERRO — e por que ela precisa de nome próprio (RF1).
 *
 * `play()` devolve uma promessa, e o navegador a REJEITA com `AbortError`
 * sempre que o pedido é interrompido por um `load()`/`pause()` que veio depois.
 * Ou seja: em toda troca rápida de faixa, sempre. Não é falha de reprodução, é
 * o navegador dizendo "esse pedido ficou obsoleto, o novo manda".
 *
 * Tratá-la como bloqueio de autoplay era o defeito: quem apertava "próxima"
 * cinco vezes recebia cinco erros de tipo `'play'`, a store parava o player e
 * mostrava um toast vermelho acusando o navegador de um erro causado pela
 * própria troca de faixa. Pior, cada um pendurava ouvintes de gesto para
 * "retomar" um elemento que já não era o da vez.
 *
 * `NotAllowedError` — o bloqueio de autoplay de verdade — continua passando: lá
 * o aviso é útil, porque basta a pessoa tocar na página. Distinguir os dois é
 * todo o conserto.
 */
/**
 * FILTRO DE DURAÇÃO — `0` quer dizer "ainda não sei", e é a única resposta
 * honesta que não estraga a barra (RF2).
 *
 * `HTMLMediaElement.duration` mente de três jeitos e sempre os mesmos: `NaN`
 * antes do `loadedmetadata` (o começo inteiro da faixa), `Infinity` em stream
 * sem `Content-Length` (o `/stream` do ajudante responde em chunks, que é a
 * maior parte do acervo importado) e `0` quando a fonte falhou.
 *
 * Nenhum dos três é um tempo. Deixá-los escapar produzia "0:00" eterno na
 * barra, "NaN:aN" quando a faixa também não tinha duração no registro, e uma
 * exceção no `setPositionState` da tela de bloqueio. Tudo o que sai daqui é
 * finito, positivo, ou `0` — e quem recebe `0` sabe que precisa perguntar a
 * outro.
 */
function duracaoValida(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : 0;
}

function ehAbortoDeTroca(erro: unknown): boolean {
  // `DOMException` nem sempre herda de `Error` (depende do motor), então a
  // checagem é pelo `name`, que é o contrato da especificação.
  return (
    typeof erro === 'object' && erro !== null && (erro as { name?: string }).name === 'AbortError'
  );
}

export class AudioEngine {
  private static _instance: AudioEngine | null = null;

  static getInstance(): AudioEngine {
    return (AudioEngine._instance ??= new AudioEngine());
  }

  private constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  private audioUnlocked = false;

  /**
   * DESTRAVA O ÁUDIO NO PRIMEIRO GESTO DO USUÁRIO — o conserto do "clico e
   * demora / aparece parado / buga".
   *
   * A raiz: uma faixa de catálogo ou importada resolve a fonte (cache local,
   * URL de /stream, nó do Audius) com `await` ANTES de chamar `el.play()`.
   * Quando o play finalmente acontece, a "ativação por gesto" do clique já
   * expirou, e o navegador BLOQUEIA a reprodução por política de autoplay — o
   * motor emite erro 'play', a store marca pausado, e só um SEGUNDO clique toca.
   *
   * A cura é padrão de mercado: no PRIMEIRO gesto da sessão, (1) já deixamos o
   * AudioContext rodando e (2) tocamos um clipe silencioso, o que concede à
   * página o "engajamento de mídia". A partir daí, `play()` programático —
   * mesmo depois de um await de rede — não é mais barrado. Idempotente.
   */
  unlock = (): void => {
    // O estoque é reabastecido em TODO gesto, não só no primeiro.
    this.abastecerEstoque();
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    if (!SEM_GRAFO_WEB_AUDIO) {
      this.ensureGraph();
      void this.ctx?.resume().catch(() => undefined);
    }
    try {
      const primer = new Audio(
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
      );
      primer.volume = 0.0001;
      void primer
        .play()
        .then(() => primer.pause())
        .catch(() => undefined);
    } catch {
      /* sem primer: no pior caso, o comportamento de antes */
    }
  };

  // ── Web Audio graph ────────────────────────────────────────────
  private ctx: AudioContext | null = null;
  private webAudioFailed = false;
  private eqInput: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private master: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;

  // ── Slots ──────────────────────────────────────────────────────
  private slots: [Slot, Slot] = [createSlot(), createSlot()];
  private activeIndex: SlotIndex = 0;

  // ── State ──────────────────────────────────────────────────────
  /** Resolves an offline/local source URL for a track, if one is cached. */
  private localResolver: ((track: TrackDto) => string | null) | null = null;
  private playing = false;
  /**
   * A INTENÇÃO, separada da CONFIRMAÇÃO — `playing` (acima) vira `false` assim
   * que um `play()` bloqueado prova que não saiu som (ver `startSlot`), mas
   * isso não quer dizer que a pessoa (ou o boot) desistiu de tocar. Este campo
   * é só isso: continua `true` até um `pause()` de verdade, e é ele — não
   * `playing` — que decide se o ouvinte de "retoma no primeiro gesto" ainda
   * deve agir.
   */
  private desejaTocar = false;
  /** Posição de partida da próxima carga (ver `iniciarEm`). */
  private inicioPedido: number | null = null;
  private volume = 1;
  private muted = false;
  private rate = 1;
  private eqEnabled = false;
  private eqGains: readonly number[] = EQ_BANDS_HZ.map(() => 0);
  private normalize = true;
  private rafId: number | null = null;
  private hiddenTicker: ReturnType<typeof setInterval> | null = null;
  private fadeTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Rampas de volume próprias (sem grafo) por slot — ver `rampFade`. */
  private rampasDeVolume = new Map<Slot, ReturnType<typeof setInterval>>();
  /** Cancela as esperas de `retireSlot` ainda pendentes. */
  private retireCancels = new Set<() => void>();
  private destroyed = false;

  private listeners: {
    [K in keyof AudioEngineEventMap]: Set<(p: AudioEngineEventMap[K]) => void>;
  } = {
    timeupdate: new Set(),
    loaded: new Set(),
    ended: new Set(),
    error: new Set(),
    interrupted: new Set(),
    buffering: new Set(),
    unlocked: new Set(),
  };

  /** AnalyserNode for spectrum visualizers — null until first playback / if Web Audio failed. */
  get analyser(): AnalyserNode | null {
    return this._analyser;
  }

  get currentTrack(): TrackDto | null {
    return this.active.track;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // ── Events ─────────────────────────────────────────────────────

  on<K extends keyof AudioEngineEventMap>(
    event: K,
    listener: (payload: AudioEngineEventMap[K]) => void,
  ): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  off<K extends keyof AudioEngineEventMap>(
    event: K,
    listener: (payload: AudioEngineEventMap[K]) => void,
  ): void {
    this.listeners[event].delete(listener);
  }

  private emit<K extends keyof AudioEngineEventMap>(
    event: K,
    payload: AudioEngineEventMap[K],
  ): void {
    for (const listener of this.listeners[event]) listener(payload);
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Register a resolver that returns a cached/offline source URL for a track
   * (e.g. a blob: URL of a downloaded file). Used before the network stream.
   */
  setLocalSourceResolver(resolver: ((track: TrackDto) => string | null) | null): void {
    this.localResolver = resolver;
  }

  /** Local (offline) source if available, else the network stream URL. */
  private sourceFor(track: TrackDto): string | null {
    return this.localResolver?.(track) ?? track.streamUrl ?? null;
  }

  /** Load a track into the engine, optionally crossfading from the current one. */
  /**
   * ONDE A PRÓXIMA CARGA COMEÇA — antes do primeiro som, não depois.
   *
   * A retomada (recarregar a página, atualização, trazer a música de outro
   * aparelho) carregava a faixa do zero e só no 'loaded' buscava a posição
   * salva: dava para ouvir o COMEÇO da música antes do salto. Agora quem
   * retoma avisa aqui, e o próximo `load()` posiciona o áudio antes de tocar.
   * Uso único: a carga seguinte já nasce sem ele.
   */
  iniciarEm(segundos: number | null): void {
    this.inicioPedido = segundos !== null && segundos > 0 ? segundos : null;
  }

  /**
   * Posiciona a faixa antes do primeiro som. Devolve `true` quando o play tem
   * que ESPERAR o carregamento (e sair de lá, já posicionado).
   *
   * O Howler não posiciona o que ainda não carregou: com a faixa "unloaded",
   * `seek(x)` desiste em silêncio (nem entra na fila dele), e o evento 'load'
   * dele chega DEPOIS de a fila rodar o play — o play saía em 0 e o salto
   * vinha depois, com o começo da música tocando no meio. Então, sem carregar,
   * o motor segura o play e o dá no próprio 'load', depois do seek.
   */
  private posicionarAntesDeTocar(slot: Slot, segundos: number): boolean {
    const fonte = slot.source;
    if (!fonte) return false;
    if (fonte.kind === 'howl') {
      if (fonte.howl.state() === 'loaded') {
        fonte.howl.seek(segundos);
        return false;
      }
      slot.inicioAoCarregar = segundos;
      // O Howler só começa a carregar quando alguém pede play — e o play está
      // sendo segurado. Sem pedir o carregamento aqui, o 'load' nunca chegaria.
      if (fonte.howl.state() === 'unloaded') fonte.howl.load();
      return true;
    }
    // Elemento sem metadados ainda: o `currentTime` vira a posição inicial.
    fonte.el.currentTime = segundos;
    return false;
  }

  load(track: TrackDto, options: LoadOptions = {}): void {
    if (this.destroyed) return;
    const { autoplay = true, crossfadeSeconds = 0 } = options;
    const inicio = this.inicioPedido;
    this.inicioPedido = null;
    const wasPlaying = this.playing;
    const source = this.sourceFor(track);
    if (!source) {
      this.emit('error', { message: 'Faixa indisponível para reprodução.', track, kind: 'source' });
      return;
    }
    const url = resolveMediaUrl(source);
    this.ensureGraph();
    void this.ctx?.resume().catch(() => undefined);

    const fromIndex = this.activeIndex;
    const toIndex: SlotIndex = fromIndex === 0 ? 1 : 0;
    const from = this.slots[fromIndex];
    const to = this.slots[toIndex];

    const preloaded = to.track?.id === track.id && to.source !== null;
    if (preloaded) {
      to.track = track; // refresh DTO (isLiked etc.)
    } else {
      this.resetSlot(to);
      this.prepareSlot(to, track, url);
    }
    // Um slot PRÉ-CARREGADO já disparou seu 'load' enquanto era o slot ocioso —
    // e aqueles handlers são filtrados por `slot === this.active`, então o store
    // nunca recebeu 'loaded'/'buffering:false' para ele. Sem re-emitir aqui, o
    // isBuffering fica true para sempre: o player parece TRAVADO no spinner.
    const promotedLoaded = preloaded && to.loaded;
    const promotedFalhou = preloaded && to.falhouAoCarregar === true;
    const esperarCarregar = inicio !== null && this.posicionarAntesDeTocar(to, inicio);

    const querMisturar = crossfadeSeconds > 0 && this.playing && from.track !== null;
    /**
     * O CROSSFADE NO CELULAR ERA UM CORTE. Sem grafo Web Audio (todo celular,
     * pela reprodução em segundo plano), `canCrossfade` dava falso e o motor
     * caía na troca seca: a música atual era CORTADA `crossfadeSeconds` antes
     * do fim e a próxima entrava sem mistura nenhuma — a pessoa perdia o final
     * de toda faixa e não ouvia crossfade algum.
     *
     * Agora: com grafo, ganho; sem grafo no Android, o fade de volume do
     * Howler; no iPhone — onde o Safari ignora o volume do elemento — a que sai
     * TOCA ATÉ O FIM por baixo da que entra (`deixarTerminar`). Nunca corta.
     */
    const canCrossfade =
      querMisturar && (this.ctx !== null || (!IS_IOS && from.source?.kind === 'howl'));
    const sobrepor = querMisturar && !canCrossfade;

    // SEM GRAFO, O VOLUME É DO PRÓPRIO ELEMENTO — e o slot promovido pode estar no
    // meio de uma rampa de SAÍDA (voltar para a faixa que a mistura ainda
    // aposentava, o botão "anterior" nos primeiros segundos da seguinte). Sem
    // parar a rampa, o passo seguinte a leva até 0 e a faixa que a pessoa acabou
    // de pedir toca MUDA. Com grafo isto é o `setFade` abaixo; o ramo de mistura
    // (canCrossfade) já reescreve o volume sozinho.
    if (preloaded && !this.ctx && !canCrossfade) {
      this.pararRampaDeVolume(to);
      this.gravarVolume(to, this.effectiveVolume());
    }

    this.activeIndex = toIndex;

    if (sobrepor) {
      if (autoplay && !esperarCarregar) this.startSlot(to);
      this.playing = autoplay;
      this.desejaTocar = autoplay;
      this.deixarTerminar(from, crossfadeSeconds);
    } else if (canCrossfade) {
      this.setFade(to, 0);
      this.startSlot(to);
      // Sem grafo: a que entra nasce em 0 no próprio elemento (o `play()` do
      // Howler regrava `_volume` no elemento, por isso vem DEPOIS do startSlot).
      if (!this.ctx) this.gravarVolume(to, 0);
      this.rampFade(to, 1, crossfadeSeconds);
      this.rampFade(from, 0, crossfadeSeconds);
      const fromSeq = from.seq; // guard: skip cleanup if the slot was reused meanwhile
      const timer = setTimeout(
        () => {
          this.fadeTimers.delete(timer);
          // `from !== this.active`: voltar para a faixa que ainda está SAINDO
          // (botão "anterior" no meio da mistura) a promove como pré-carregada
          // sem mexer no `seq` — e este temporizador, armado contra ela, a
          // desmontaria já ATIVA: silêncio total com a store achando que toca.
          if (from.seq === fromSeq && from !== this.active) this.resetSlot(from);
        },
        crossfadeSeconds * 1000 + 120,
      );
      this.fadeTimers.add(timer);
      this.playing = true;
      this.desejaTocar = true;
    } else {
      this.setFade(to, 1);
      // Posição pendente: o play sai no 'load' do slot, já no ponto.
      if (autoplay && !esperarCarregar) this.startSlot(to);
      this.playing = autoplay;
      this.desejaTocar = autoplay;
      // Depois de começar a nova, nunca antes — ver `retireSlot`.
      this.retireSlot(from, to, wasPlaying && autoplay);
    }

    this.applyRate(to);
    this.applyTrim(to);
    this.syncTicker();
    this.emit('timeupdate', { position: inicio ?? 0, duration: this.getDuration() });
    if (promotedLoaded) {
      this.emit('loaded', { track, duration: this.getDuration() });
      this.emit('buffering', { buffering: false });
    } else if (promotedFalhou) {
      // A fonte já tinha morrido quando era só pré-carga e ninguém ficou
      // sabendo: avisa agora, para a store trocar de fonte em vez de esperar o
      // watchdog (ou nada, na mistura) diante de um slot que nunca vai tocar.
      this.emit('error', { message: PLAYBACK_ERROR, track, kind: 'load' });
    }
  }

  play(): void {
    if (this.destroyed || !this.active.source) return;
    // Posição esperando o carregamento: o play sai de lá, já no ponto (ver
    // `posicionarAntesDeTocar`) — nunca o começo da música antes do salto.
    if (this.active.inicioAoCarregar == null) this.startSlot(this.active);
    this.playing = true;
    this.desejaTocar = true;
    this.syncTicker();
  }

  pause(): void {
    const slot = this.active;
    if (slot.source?.kind === 'howl') slot.source.howl.pause();
    else slot.source?.el.pause();
    this.playing = false;
    this.desejaTocar = false; // pausa DE VERDADE — o próximo gesto não deve reviver isto
    this.syncTicker();
  }

  stop(): void {
    this.pause();
    this.seek(0);
  }

  seek(seconds: number): void {
    const slot = this.active;
    const target = Math.max(0, seconds);
    if (slot.source?.kind === 'howl') {
      // Sem carregar, o Howler ignora o seek em silêncio: guarda para o 'load'.
      const howl = slot.source.howl;
      if (howl.state() === 'loaded') howl.seek(target);
      else {
        slot.inicioAoCarregar = target;
        if (howl.state() === 'unloaded') howl.load();
      }
    } else if (slot.source) slot.source.el.currentTime = target;
    this.emit('timeupdate', { position: target, duration: this.getDuration() });
  }

  getPosition(): number {
    const slot = this.active;
    if (slot.source?.kind === 'howl') {
      // O ELEMENTO É A VERDADE. `howl.seek()` devolve o próprio Howl (não um
      // número) enquanto o Howler está com o play "travado" — exatamente o
      // estado da retomada depois de uma atualização com o autoplay recusado e
      // destravado por um toque. A posição virava 0, e a letra ficava parada no
      // começo com a música tocando no meio.
      const no = (slot.source.howl as unknown as HowlInternals)._sounds?.[0]?._node;
      if (no && Number.isFinite(no.currentTime)) return no.currentTime;
      const pos = slot.source.howl.seek();
      return typeof pos === 'number' ? pos : 0;
    }
    return slot.source?.el.currentTime ?? 0;
  }

  /**
   * O tempo total da faixa ativa, em segundos. **Sempre finito e ≥ 0.**
   *
   * A ordem é a da confiabilidade, e não a da conveniência:
   *  1. o que o elemento MEDIU — é o número real, quando existe;
   *  2. o fim do range `seekable` — alguns navegadores só expõem o total por
   *     aqui, mantendo `duration` em `Infinity` por boa parte do stream;
   *  3. o que o REGISTRO guarda (`durationMs`, vindo da importação/catálogo) —
   *     é o que cobre todo o intervalo antes do `loadedmetadata`, e é por ele
   *     que a barra já mostra o tempo total no instante em que a faixa começa;
   *  4. `0`, que quer dizer "ninguém sabe" — e é melhor que mentir com `NaN`.
   */
  getDuration(): number {
    const slot = this.active;
    let duration = 0;
    if (slot.source?.kind === 'howl') {
      // O ELEMENTO ANTES DO HOWLER: `howl.duration()` é congelada no
      // 'canplaythrough' (arredondada, e `Infinity` em stream em chunks). Num
      // stream cujo total o navegador estima por baixo e corrige depois, ela
      // ficava MENOR que a faixa — e tudo que decide pelo "quanto falta" (troca
      // antecipada, crossfade) cortava a música no meio.
      const no = (slot.source.howl as unknown as HowlInternals)._sounds?.[0]?._node;
      duration = duracaoValida(no?.duration) || duracaoValida(slot.source.howl.duration());
    } else if (slot.source) duration = duracaoValida(slot.source.el.duration);
    if (!duration && slot.el && slot.el.seekable.length > 0) {
      try {
        duration = duracaoValida(slot.el.seekable.end(slot.el.seekable.length - 1));
      } catch {
        /* range instável durante o carregamento */
      }
    }
    // `durationMs` pode ser `NaN`/ausente numa faixa importada de arquivo sem
    // tags — daí passar TAMBÉM pelo filtro, e não só dividir por mil.
    if (!duration) duration = duracaoValida((slot.track?.durationMs ?? 0) / 1000);
    return duration;
  }

  /**
   * A DURAÇÃO É A DE VERDADE? Só então dá para começar a próxima ANTES do fim
   * (crossfade, troca com a tela apagada). Vale quando o arquivo já foi todo
   * baixado — aí o elemento sabe o tamanho exato — ou quando a duração medida
   * bate com a do catálogo. Estimativa do Safari para MP3 transmitido, sozinha,
   * não conta: ela costuma vir menor e fazia a música ser trocada no meio.
   */
  duracaoConfiavel(): boolean {
    const slot = this.active;
    const el = slot.el;
    if (!el) return false;
    const medida = duracaoValida(el.duration);
    if (!medida) return false;
    try {
      const b = el.buffered;
      if (b.length > 0 && b.end(b.length - 1) >= medida - 0.5) return true;
    } catch {
      /* buffered instável no meio da carga */
    }
    const catalogo = duracaoValida((slot.track?.durationMs ?? 0) / 1000);
    return catalogo > 0 && Math.abs(catalogo - medida) <= 2;
  }

  /** True when the underlying media element reached EOF. */
  isTrackEnded(): boolean {
    return this.active.el?.ended ?? false;
  }

  /** End of the buffered range containing the playhead (seconds) — seek-bar underlay. */
  getBufferedEnd(): number {
    const el = this.active.el;
    if (!el) return 0;
    const position = this.getPosition();
    try {
      for (let i = 0; i < el.buffered.length; i++) {
        if (el.buffered.start(i) <= position && position <= el.buffered.end(i)) {
          return el.buffered.end(i);
        }
      }
    } catch {
      /* buffered ranges may throw mid-load */
    }
    return 0;
  }

  /** 0..1 with a smooth ~80ms ramp (no zipper noise). */
  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /** 0.5..2 playback rate (pitch preserved). */
  setRate(rate: number): void {
    this.rate = clamp(rate, 0.5, 2);
    for (const slot of this.slots) this.applyRate(slot);
  }

  /**
   * Preload the next queue item into the idle slot (gapless).
   * Call with null to release the idle slot.
   */
  preloadNext(track: TrackDto | null): void {
    if (this.destroyed) return;
    const idle = this.slots[this.activeIndex === 0 ? 1 : 0];
    if (!track) {
      if (idle.track) this.resetSlot(idle);
      return;
    }
    const source = this.sourceFor(track);
    if (idle.track?.id === track.id || !source) return;
    this.resetSlot(idle);
    this.prepareSlot(idle, track, resolveMediaUrl(source));
  }

  /** 10-band EQ (dB gains aligned with EQ_BANDS_HZ). Disabled = flat, zero cost. */
  setEq(options: { enabled: boolean; gains: readonly number[] }): void {
    this.eqEnabled = options.enabled;
    this.eqGains = options.gains;
    this.applyEq();
  }

  /** Toggle ReplayGain loudness normalization (target −14 LUFS). */
  setNormalizeVolume(enabled: boolean): void {
    this.normalize = enabled;
    for (const slot of this.slots) this.applyTrim(slot);
  }

  destroy(): void {
    this.destroyed = true;
    for (const timer of this.fadeTimers) clearTimeout(timer);
    this.fadeTimers.clear();
    for (const slot of [...this.rampasDeVolume.keys()]) this.pararRampaDeVolume(slot);
    for (const cancel of [...this.retireCancels]) cancel();
    for (const slot of this.slots) this.resetSlot(slot);
    this.stopTicker();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this._analyser = null;
    for (const set of Object.values(this.listeners)) set.clear();
    AudioEngine._instance = null;
  }

  // ── Graph ──────────────────────────────────────────────────────

  private ensureGraph(): void {
    if (this.ctx || this.webAudioFailed || typeof window === 'undefined') return;
    if (SEM_GRAFO_WEB_AUDIO) {
      // Caminho do `<audio>` puro: tocar com a tela apagada ganha do EQ. Ver o
      // bloco no topo do arquivo para o porquê de a decisão ser por plataforma
      // e não por visibilidade.
      this.webAudioFailed = true;
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.eqInput = ctx.createGain();
      this.eqFilters = EQ_BANDS_HZ.map((hz) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = hz;
        filter.Q.value = 1.0;
        filter.gain.value = 0;
        return filter;
      });
      this.master = ctx.createGain();
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0.8;

      let node: AudioNode = this.eqInput;
      for (const filter of this.eqFilters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(this.master);
      this.master.connect(this._analyser);
      this._analyser.connect(ctx.destination);
      this.master.gain.value = this.effectiveVolume();
      this.applyEq();
    } catch {
      // TODO: hls.js fallback path also lands here on very old browsers.
      this.webAudioFailed = true;
      this.ctx = null;
    }
  }

  private slotNodes(slot: Slot): { trim: GainNode; fade: GainNode } | null {
    if (!this.ctx || !this.eqInput) return null;
    if (!slot.trim || !slot.fade) {
      slot.trim = this.ctx.createGain();
      slot.fade = this.ctx.createGain();
      slot.trim.connect(slot.fade);
      slot.fade.connect(this.eqInput);
    }
    return { trim: slot.trim, fade: slot.fade };
  }

  private connectSlotElement(slot: Slot, el: HTMLAudioElement): void {
    slot.el = el;
    const nodes = this.slotNodes(slot);
    if (!this.ctx || !nodes) return;
    // ELEMENTO SEM CORS NUNCA ENTRA NO GRAFO. `createMediaElementSource` NÃO lança
    // com mídia de outra origem sem `crossOrigin`: o som passa a sair do contexto
    // e o navegador o ZERA (saída muda) — enquanto o `currentTime` segue andando.
    // É o "o tempo passa e não toca": nenhum elo do grafo está errado, o
    // invariante de saída não vê nada, e entrar no grafo é irreversível para o
    // elemento. Fora do grafo ele toca direto (sem EQ), com o volume no próprio
    // elemento — ver `volumeDeElementoForaDoGrafo`.
    if (!mediaSourceCache.has(el) && this.fonteSemCors(el)) {
      slot.mediaSource = null;
      this.volumeDeElementoForaDoGrafo(slot, el);
      return;
    }
    try {
      let source = mediaSourceCache.get(el);
      if (!source) {
        source = this.ctx.createMediaElementSource(el);
        mediaSourceCache.set(el, source);
      }
      source.disconnect();
      source.connect(nodes.trim);
      slot.mediaSource = source;
    } catch {
      // Tainted (no CORS) or already-claimed element: keep direct output.
      slot.mediaSource = null;
    }
  }

  /** Mídia de OUTRA origem carregada por um elemento sem `crossOrigin`? (muda no grafo) */
  private fonteSemCors(el: HTMLAudioElement): boolean {
    if (el.crossOrigin === 'anonymous' || el.crossOrigin === 'use-credentials') return false;
    const src = el.currentSrc || el.src;
    if (!src || typeof location === 'undefined') return false; // sem como saber: tenta o grafo
    try {
      const url = new URL(src, location.href);
      return /^https?:$/.test(url.protocol) && url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  /** O Howl nasce com volume 1 quando há contexto (o `master` cuida do volume): fora do grafo o elemento é a saída. */
  private volumeDeElementoForaDoGrafo(slot: Slot, el: HTMLAudioElement): void {
    if (!this.rampasDeVolume.has(slot)) {
      el.volume = clamp(this.effectiveVolume(), 0, 1);
      this.gravarVolume(slot, this.effectiveVolume());
    }
  }

  // ── Slot lifecycle ─────────────────────────────────────────────

  private get active(): Slot {
    return this.slots[this.activeIndex];
  }

  private prepareSlot(slot: Slot, track: TrackDto, url: string): void {
    slot.track = track;
    slot.url = url;
    slot.loaded = false;
    slot.falhouAoCarregar = false;
    if (isHlsUrl(url)) void this.prepareElementSlot(slot, track, url);
    else this.prepareHowlSlot(slot, track, url);
  }

  private prepareHowlSlot(slot: Slot, track: TrackDto, url: string): void {
    const seq = ++slot.seq;
    this.primeHtml5Pool();
    this.garantirEstoqueComCors();

    const extension = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
    const howl = new Howl({
      src: [url],
      html5: true, // stream instead of buffering the whole file
      preload: true,
      volume: this.ctx ? 1 : this.effectiveVolume(),
      // URL assinada sem extensao nao garante MP3: sem esse cuidado,
      // algumas faixas (AAC/Opus/FLAC) quebram enquanto outras tocam.
      //
      // SEM EXTENSÃO (blob: do aparelho, link do cofre): o Howler recusava a
      // carga — "No codec support" —, e a faixa só tocava porque o player caía
      // numa segunda fonte; na troca, a posição de retomada se perdia e a
      // música saía do COMEÇO. O `format` aqui só abre o portão do Howler (ele
      // confere o codec pelo nome); quem decodifica é o navegador, pelo
      // conteúdo real. 'mp3' passa no portão de todo navegador.
      format: [extension ?? 'mp3'],
    });
    slot.source = { kind: 'howl', howl };

    howl.on('load', () => {
      if (slot.seq !== seq) return;
      slot.loaded = true;
      const el = (howl as unknown as HowlInternals)._sounds[0]?._node ?? null;
      if (el) {
        this.connectSlotElement(slot, el);
        this.attachBufferingEvents(slot, el, seq);
        this.attachInterruptionEvents(slot, el, seq);
        // Duração tardia (stream sem Content-Length / chunked): reemite quando
        // o elemento finalmente souber o tamanho real da faixa.
        const onDurationChange = (): void => {
          if (slot.seq !== seq || slot !== this.active) return;
          if (Number.isFinite(el.duration) && el.duration > 0) {
            this.emit('loaded', { track, duration: el.duration });
          }
        };
        el.addEventListener('durationchange', onDurationChange);
        slot.cleanup.push(() => el.removeEventListener('durationchange', onDurationChange));
        el.addEventListener('ended', darFim);
        slot.cleanup.push(() => el.removeEventListener('ended', darFim));
      }
      this.applyRate(slot);
      this.applyTrim(slot);
      // A retomada que esperava o carregamento: posiciona e SÓ ENTÃO toca.
      const inicio = slot.inicioAoCarregar;
      if (inicio !== null && inicio !== undefined) {
        slot.inicioAoCarregar = null;
        howl.seek(inicio);
        if (slot === this.active && this.desejaTocar) this.startSlot(slot);
      }
      if (slot === this.active) {
        // `getDuration()` já é a cascata inteira (medida → seekable → registro),
        // e sempre finita. O `howl.duration()` cru estava aqui antes e deixava
        // `Infinity` passar — porque `Infinity || x` é `Infinity`.
        this.emit('loaded', { track, duration: this.getDuration() });
        this.emit('buffering', { buffering: false });
      }
    });
    // O 'end' do Howler NÃO é prova de fim. Num html5 ele pode vir de um
    // temporizador próprio (`howl.rate()` troca o ouvinte do 'ended' nativo por
    // um `setTimeout` calculado com a duração CONGELADA do load), que dispara
    // com a faixa ainda tocando quando o stream revelou um total maior — e a
    // fila pulava no meio da música. Só vale se o elemento também acabou; o
    // 'ended' nativo (ouvido no 'load') cobre o fim de verdade, já que o timer
    // pode ter apagado o ouvinte do Howler. `fimDado` evita avançar duas vezes
    // quando os dois caminhos chegam.
    let fimDado = false;
    const darFim = (): void => {
      if (fimDado || slot.seq !== seq || slot !== this.active) return;
      fimDado = true;
      this.handleEnded();
    };
    howl.on('play', () => {
      fimDado = false; // repetir-uma / nova rodada na mesma instância
    });
    howl.on('end', () => {
      const no = (howl as unknown as HowlInternals)._sounds?.[0]?._node;
      if (no && !no.ended && !no.paused) {
        const total = no.duration;
        // Elemento ainda tocando e longe do fim: o 'end' é do timer, ignora.
        if (!Number.isFinite(total) || total - no.currentTime > 1.5) return;
      }
      darFim();
    });
    howl.on('loaderror', () => this.falhaDeCarga(slot, seq, track));
    howl.on('playerror', () => {
      if (slot.seq !== seq || slot !== this.active) return;
      // O PLAY FOI RECUSADO — e ninguém ficava sabendo. O motor seguia com
      // `playing = true` e a store mostrava "Pausar" com a música muda (o boot
      // retomando depois de uma atualização, com o autoplay bloqueado). Agora
      // é o mesmo desfecho do caminho do elemento: o motor se sabe parado e
      // avisa; a store troca o botão (ou mostra o convite discreto da retomada).
      this.playing = false;
      this.syncTicker();
      this.emit('error', {
        message: 'Reprodução bloqueada pelo navegador — toque na página e tente novamente.',
        track,
        kind: 'play',
      });
      // Retry once after the browser unlocks audio (autoplay policy).
      // `slot === this.active` também no retorno, e não só o `seq`: um slot
      // PRÉ-CARREGADO continua com o mesmo `seq` enquanto espera a vez, e
      // religá-lo aqui poria duas faixas no ar ao mesmo tempo (RNF5).
      // A INTENÇÃO (`desejaTocar`), não `playing`: é ela que diz se a pessoa
      // ainda quer ouvir quando o destravamento chegar.
      howl.once('unlock', () => {
        if (slot.seq === seq && slot === this.active && this.desejaTocar && !howl.playing()) {
          howl.play();
        }
      });
    });
    slot.cleanup.push(() => howl.unload());
  }

  /**
   * A fonte deste slot não carrega. Slot ativo: avisa a store (que tenta outra
   * fonte). Slot OCIOSO (pré-carregado): só anota — falar por ele seria a store
   * reagir a uma faixa que nem começou —, e `load()` entrega o aviso se ele
   * for promovido. Sem isto, a próxima faixa de uma fonte morta virava
   * silêncio sem causa nenhuma.
   */
  private falhaDeCarga(slot: Slot, seq: number, track: TrackDto): void {
    if (slot.seq !== seq) return;
    if (slot === this.active) {
      this.emit('error', { message: PLAYBACK_ERROR, track, kind: 'load' });
    } else {
      slot.falhouAoCarregar = true;
    }
  }

  private async prepareElementSlot(slot: Slot, track: TrackDto, url: string): Promise<void> {
    const seq = ++slot.seq;
    // Um elemento DESTRAVADO do estoque (ver `abastecerEstoque`): criado aqui,
    // fora do toque, o iPhone recusaria o play.
    const pool = (Howler as unknown as HowlerInternals)._html5AudioPool;
    const el = (Array.isArray(pool) && pool.length > 0 ? pool.pop() : null) ?? new Audio();
    el.removeAttribute('src');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    slot.source = { kind: 'element', el, hls: null };
    slot.el = el;

    const onMeta = (): void => {
      if (slot.seq !== seq) return;
      slot.loaded = true;
      this.applyRate(slot);
      this.applyTrim(slot);
      if (slot === this.active) {
        // `el.duration` cru sai daqui pelo mesmo motivo do caminho do howler:
        // stream em chunks anuncia `Infinity` no `loadedmetadata`, e era isso
        // que chegava à barra. Ver `getDuration`.
        this.emit('loaded', { track, duration: this.getDuration() });
        this.emit('buffering', { buffering: false });
      }
    };
    const onEnded = (): void => {
      if (slot.seq === seq && slot === this.active) this.handleEnded();
    };
    const onError = (): void => this.falhaDeCarga(slot, seq, track);
    // Streams em chunks só revelam a duração real DEPOIS do loadedmetadata
    // (antes é Infinity/NaN) — sem isso a faixa fica em "0:00" para sempre.
    const onDurationChange = (): void => {
      if (slot.seq !== seq || slot !== this.active) return;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        this.emit('loaded', { track, duration: el.duration });
      }
    };
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onDurationChange);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    slot.cleanup.push(() => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onDurationChange);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    this.attachBufferingEvents(slot, el, seq);
    this.attachInterruptionEvents(slot, el, seq);
    this.connectSlotElement(slot, el);

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url; // Safari plays HLS natively
      return;
    }
    try {
      const { default: Hls } = await import('hls.js');
      if (slot.seq !== seq) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) this.falhaDeCarga(slot, seq, track);
        });
        if (slot.source?.kind === 'element') slot.source.hls = hls;
        slot.cleanup.push(() => hls.destroy());
      } else {
        el.src = url; // last resort — some browsers manage
      }
    } catch {
      el.src = url;
    }
  }

  /**
   * Distingue "o usuário pausou" de "o sistema tirou o áudio de nós".
   *
   * O ELEMENTO pausar sem que a gente tenha pedido só acontece por um motivo:
   * outra coisa assumiu o áudio do aparelho — outro app tocando, uma ligação,
   * o fone desconectado. Sem escutar isto, `this.playing` continuava `true`
   * para sempre, o watchdog do player via o playhead parado e chamava `play()`
   * de volta a cada 10s: o radinho.online ficava brigando com o outro app pelo alto-
   * falante, e ganhava. Isso nunca pode acontecer.
   *
   * Como distinguir: `pause()` nosso já zerou `this.playing` antes de o evento
   * chegar (o 'pause' do elemento é assíncrono). Então evento com
   * `this.playing === true` é interrupção de fora, e ponto.
   */
  private attachInterruptionEvents(slot: Slot, el: HTMLAudioElement, seq: number): void {
    const onPause = (): void => {
      if (slot.seq !== seq || slot !== this.active) return;
      if (!this.playing) return; // pausa nossa — já contabilizada
      if (el.ended) return; // fim da faixa, não interrupção
      this.playing = false;
      this.syncTicker();
      this.emit('interrupted', { track: slot.track });
    };
    el.addEventListener('pause', onPause);
    slot.cleanup.push(() => el.removeEventListener('pause', onPause));

    // O SOM SAIU — a verdade vem do elemento, não de quem pediu o play.
    //
    // Há caminhos em que o áudio começa sem passar pelo `.then` de um `play()`
    // nosso: o Howler, quando o navegador recusa o autoplay (a retomada depois
    // de uma atualização), guarda o play e o dispara SOZINHO no primeiro toque
    // na página. O som saía e a store seguia em "pausado" — o botão de play
    // mostrando o estado errado com a música tocando. Agora, todo 'playing' da
    // faixa ativa avisa (`unlocked`), e a store se acerta com o que se ouve.
    //
    // Se o som saiu contra a vontade (a pessoa pausou enquanto o play estava
    // na fila do navegador), quem manda é a intenção: pausa de volta.
    const onPlaying = (): void => {
      if (slot.seq !== seq || slot !== this.active || el.paused) return;
      if (!this.desejaTocar) {
        if (slot.source?.kind === 'howl') slot.source.howl.pause();
        else el.pause();
        return;
      }
      if (!this.playing) {
        this.playing = true;
        this.syncTicker();
      }
      this.emit('unlocked', { track: slot.track });
    };
    el.addEventListener('playing', onPlaying);
    slot.cleanup.push(() => el.removeEventListener('playing', onPlaying));
  }

  private attachBufferingEvents(slot: Slot, el: HTMLAudioElement, seq: number): void {
    const emit = (buffering: boolean) => (): void => {
      if (slot.seq === seq && slot === this.active) this.emit('buffering', { buffering });
    };
    const onWaiting = emit(true);
    const onReady = emit(false);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onReady);
    el.addEventListener('canplay', onReady);
    slot.cleanup.push(() => {
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onReady);
      el.removeEventListener('canplay', onReady);
    });
  }

  private startSlot(slot: Slot): void {
    if (!slot.source) return;
    // O navegador suspende o contexto quando a página passa um tempo sem som —
    // e uma troca de faixa com a tela apagada é exatamente isso. Sem retomar
    // AQUI, o elemento toca e não sai áudio nenhum.
    void this.ctx?.resume().catch(() => undefined);
    // TOKEN DE GERAÇÃO DESTE PEDIDO DE PLAY. O `seq` do slot é bumpado por
    // `resetSlot`/`prepareSlot`, e os slots se alternam: sem prendê-lo AQUI,
    // uma rejeição que chega tarde poderia falar por uma faixa que já saiu de
    // cena e por acaso reocupou o mesmo slot.
    const seq = slot.seq;
    const daVez = (): boolean => slot.seq === seq && slot === this.active;
    if (slot.source.kind === 'howl') {
      const { howl } = slot.source;
      if (!howl.playing()) howl.play();
    } else {
      const { el } = slot.source;
      void el.play().catch((erro: unknown) => {
        // Troca de faixa interrompeu este play: é o comportamento normal do
        // navegador, não uma falha. Ver `ehAbortoDeTroca` (RF1).
        if (ehAbortoDeTroca(erro)) return;
        if (!daVez()) return;
        // O PLAY FALHOU DE VERDADE — `this.playing` não pode continuar `true`.
        //
        // `load()`/`play()` marcam `this.playing` ANTES de saber se `el.play()`
        // vai vingar (é o que deixa a troca de faixa otimista e responsiva).
        // Sem desfazer isto aqui, o motor passava a acreditar que tocava com o
        // alto-falante mudo — e um `toggle()` seguinte, lendo o estado errado
        // por fora, podia interpretar o próximo toque como "pausar" em vez de
        // "tocar". `isPlaying` (getter) espelha isto direto; a store confia
        // nele em mais de um lugar (`play()`, o watchdog de travamento).
        this.playing = false;
        // Autoplay bloqueado: em vez de só reclamar, retoma sozinho no PRIMEIRO
        // gesto do usuário (igual ao 'unlock' do Howler) — senão a faixa fica
        // parada mesmo depois de o usuário interagir com a página.
        const resume = (): void => {
          detach();
          // A INTENÇÃO, não a confirmação: `playing` acabou de virar `false`
          // aqui em cima (o play falhou) e continuaria assim para sempre.
          if (!daVez() || !this.desejaTocar) return;
          // AVISA QUANDO PEGA — sem isto o som volta a sair, mas a store nunca
          // fica sabendo: `isPlaying` continuava `false` para sempre com áudio
          // audível no alto-falante (o "estado preso" ao contrário). Quem ouve
          // este evento sincroniza `isPlaying` e apaga qualquer convite de
          // retomada que estivesse na tela — o toque, seja onde for, já resolveu.
          void el
            .play()
            .then(() => {
              if (!daVez()) return;
              this.playing = true; // pegou: o motor volta a se saber tocando
              this.syncTicker();
              this.emit('unlocked', { track: slot.track });
            })
            .catch(() => undefined);
        };
        const detach = (): void => {
          document.removeEventListener('pointerdown', resume);
          document.removeEventListener('keydown', resume);
        };
        document.addEventListener('pointerdown', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
        slot.cleanup.push(detach);
        this.emit('error', {
          message: 'Reprodução bloqueada pelo navegador — toque na página e tente novamente.',
          track: slot.track,
          kind: 'play',
        });
      });
    }
  }

  /**
   * Aposenta o slot que sai SEM deixar a página um só instante sem mídia tocando.
   *
   * A ordem antiga era: matar a faixa velha, depois começar a nova. Entre uma
   * coisa e outra cabe TODO o carregamento da faixa nova — segundos, numa rede
   * de celular. Com a tela acesa ninguém nota. Com a tela apagada, esse silêncio
   * é o app dizendo ao Android "não estou mais tocando nada": o sistema encerra
   * a sessão de mídia da página, e quando o áudio novo finalmente começa ele é
   * pausado logo em seguida. É exatamente o "toca um pouco e para" ao trocar de
   * faixa com a tela desligada.
   *
   * Agora a faixa velha some do alto-falante na hora (ganho a zero em 120ms),
   * mas o ELEMENTO continua tocando até o novo pegar no tranco. Para o sistema
   * a página nunca parou; para o ouvido, a troca é seca como antes.
   *
   * `keepAlive` falso (estava pausado, ou carga sem autoplay) = nada a preservar,
   * derruba na hora. Sem grafo Web Audio (iOS, ou elemento sem CORS que não pôde
   * entrar no grafo) também: lá o elemento É a saída, e calá-lo sem pausar é
   * impossível — deixar tocando seriam DUAS faixas ao mesmo tempo.
   */
  /**
   * A faixa que sai segue tocando ATÉ O FIM NATURAL dela (ou até um teto de
   * segurança), e só então é desmontada. É a mistura possível onde não dá para
   * mexer no volume (iPhone): as duas soam juntas no fim, e ninguém perde o
   * final da música.
   */
  private deixarTerminar(from: Slot, segundos: number): void {
    if (!from.source) return;
    const fromSeq = from.seq;
    const el = from.el;
    const teto = setTimeout(() => desmontar(), (segundos + 4) * 1000);
    const desmontar = (): void => {
      clearTimeout(teto);
      el?.removeEventListener('ended', desmontar);
      this.retireCancels.delete(desmontar);
      if (from.seq === fromSeq && from !== this.active) this.resetSlot(from);
    };
    el?.addEventListener('ended', desmontar, { once: true });
    this.retireCancels.add(desmontar);
  }

  private retireSlot(from: Slot, to: Slot, keepAlive: boolean): void {
    if (!from.source) return;
    if (!keepAlive || !this.ctx || !from.mediaSource) {
      this.resetSlot(from);
      return;
    }
    this.rampFade(from, 0, 0.12);

    const fromSeq = from.seq;
    const deadline = Date.now() + RETIRE_MAX_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      this.retireCancels.delete(cancel);
    };
    const check = (): void => {
      timer = null;
      // Reaproveitado por outra carga — ou PROMOVIDO de volta a ativo (voltar
      // para a faixa que estava sendo aposentada): desmontá-lo seria calar a
      // música que a pessoa acabou de pedir.
      if (from.seq !== fromSeq || from === this.active) {
        this.retireCancels.delete(cancel);
        return;
      }
      const el = to.el;
      const started = el !== null && !el.paused && el.currentTime > 0;
      if (started || Date.now() >= deadline) {
        this.retireCancels.delete(cancel);
        this.resetSlot(from);
        return;
      }
      timer = setTimeout(check, RETIRE_POLL_MS);
    };
    timer = setTimeout(check, RETIRE_POLL_MS);
    this.retireCancels.add(cancel);
  }

  private resetSlot(slot: Slot): void {
    slot.seq++;
    for (const dispose of slot.cleanup.splice(0)) {
      try {
        dispose();
      } catch {
        /* already gone */
      }
    }
    this.pararRampaDeVolume(slot);
    slot.mediaSource?.disconnect();
    slot.mediaSource = null;
    slot.source = null;
    slot.el = null;
    slot.track = null;
    slot.url = null;
    slot.renasceu = false;
    slot.loaded = false;
    slot.falhouAoCarregar = false;
    slot.inicioAoCarregar = null;
    if (slot.fade && this.ctx) {
      slot.fade.gain.cancelScheduledValues(this.ctx.currentTime);
      slot.fade.gain.value = 1;
    }
  }

  // ── Gain application ───────────────────────────────────────────

  private effectiveVolume(): number {
    return this.muted ? 0 : this.volume;
  }

  private applyVolume(): void {
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.effectiveVolume(), now + 0.08);
      this.masterAte = Date.now() + 400;
      // Slot que ficou FORA do grafo (fonte sem CORS) não passa pelo `master`.
      for (const slot of this.slots) {
        if (slot.source && !slot.mediaSource && slot.el && !this.rampasDeVolume.has(slot)) {
          this.gravarVolume(slot, this.effectiveVolume());
        }
      }
      return;
    }
    for (const slot of this.slots) {
      // Slot no meio de uma mistura: a rampa relê o volume a cada passo.
      if (slot.source && !this.rampasDeVolume.has(slot)) {
        this.gravarVolume(slot, this.effectiveVolume());
      }
    }
  }

  private applyRate(slot: Slot): void {
    if (slot.source?.kind === 'howl') {
      // Só quando muda: `rate()` com o play pendente vira tarefa que fica presa
      // na cabeça da fila do Howler e trava tudo que for enfileirado depois
      // (volume, seek) — ver `gravarVolume`.
      if (slot.source.howl.rate() !== this.rate) slot.source.howl.rate(this.rate);
    } else if (slot.source) {
      slot.source.el.playbackRate = this.rate;
    }
    const el = slot.el as (HTMLAudioElement & { preservesPitch?: boolean }) | null;
    if (el && 'preservesPitch' in el) el.preservesPitch = true;
  }

  private applyTrim(slot: Slot): void {
    const nodes = this.slotNodes(slot);
    if (!nodes) return;
    const lufs = slot.track?.loudnessLufs;
    nodes.trim.gain.value =
      this.normalize && typeof lufs === 'number' ? dbToLinear(replayGainDb(lufs)) : 1;
  }

  private applyEq(): void {
    this.eqFilters.forEach((filter, index) => {
      filter.gain.value = this.eqEnabled ? clamp(this.eqGains[index] ?? 0, -12, 12) : 0;
    });
  }

  private setFade(slot: Slot, value: number): void {
    const nodes = this.slotNodes(slot);
    if (!nodes || !this.ctx) return;
    const now = this.ctx.currentTime;
    nodes.fade.gain.cancelScheduledValues(now);
    nodes.fade.gain.setValueAtTime(value, now);
    slot.fadeAte = Date.now() + 200;
  }

  private rampFade(slot: Slot, target: number, seconds: number): void {
    const nodes = this.slotNodes(slot);
    if (!nodes || !this.ctx) {
      this.rampaDeVolumeSemGrafo(slot, target, seconds);
      return;
    }
    const now = this.ctx.currentTime;
    nodes.fade.gain.cancelScheduledValues(now);
    nodes.fade.gain.setValueAtTime(nodes.fade.gain.value, now);
    nodes.fade.gain.linearRampToValueAtTime(target, now + seconds);
    slot.fadeAte = Date.now() + seconds * 1000 + 300;
  }

  /** O elemento que de fato sai no alto-falante (Howl HTML5 ou elemento HLS). */
  private elementoDeSaida(slot: Slot): HTMLAudioElement | null {
    if (slot.source?.kind === 'howl') {
      return (slot.source.howl as unknown as HowlInternals)._sounds?.[0]?._node ?? null;
    }
    return slot.source?.el ?? null;
  }

  /**
   * Volume gravado SEM passar pela API do Howler, no elemento E no Howl.
   *
   * `howl.volume(v)` com o `play()` HTML5 pendente (`_playLock`) vira tarefa na
   * fila interna — e essa fila só anda quando a cabeça dela casa com o evento
   * emitido; depois de um 'play' comum, uma tarefa 'volume'/'fade' fica presa
   * até algo chamar a fila sem evento (é o que o `seek` faz: por isso tocar na
   * letra "destravava" o som). O Howl precisa conhecer o valor (`_volume`)
   * porque todo `play()` o regrava no elemento.
   */
  private gravarVolume(slot: Slot, volume: number): void {
    const v = clamp(volume, 0, 1);
    const el = this.elementoDeSaida(slot);
    if (el) el.volume = v;
    if (slot.source?.kind === 'howl') {
      const interno = slot.source.howl as unknown as HowlInternals;
      if (interno._sounds?.[0]) interno._sounds[0]._volume = v;
      interno._volume = v;
    }
  }

  private pararRampaDeVolume(slot: Slot): void {
    const id = this.rampasDeVolume.get(slot);
    if (id === undefined) return;
    clearInterval(id);
    this.rampasDeVolume.delete(slot);
  }

  /**
   * Fade de volume SEM grafo (Android) feito por nós, direto no elemento.
   *
   * O `howl.fade()` do Howler caía na mesma fila travada de `gravarVolume`: a
   * faixa que entra nascia em 0, o fade nunca rodava e ela tocava MUDA até um
   * seek. A rampa própria não depende de fila nenhuma e mede o tempo pelo
   * relógio — com a tela apagada o intervalo é espaçado pelo sistema, mas o
   * próximo passo já cai no ponto certo (e o último grava o alvo no Howl).
   */
  private rampaDeVolumeSemGrafo(slot: Slot, alvo: number, segundos: number): void {
    this.pararRampaDeVolume(slot);
    const el = this.elementoDeSaida(slot);
    if (!el || segundos <= 0) {
      this.gravarVolume(slot, alvo * this.effectiveVolume());
      return;
    }
    const efetivo = this.effectiveVolume();
    const inicio = efetivo > 0 ? clamp(el.volume / efetivo, 0, 1) : alvo === 0 ? 1 : 0;
    const t0 = Date.now();
    const ms = segundos * 1000;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      if (p >= 1) {
        this.pararRampaDeVolume(slot);
        this.gravarVolume(slot, alvo * this.effectiveVolume());
        return;
      }
      // Lido a cada passo: o volume/mudo pode mudar no meio da mistura. Só o
      // elemento — um `play()` tardio regrava `_volume` (0) e o passo seguinte
      // corrige; o alvo final vai para o Howl no último passo.
      el.volume = clamp((inicio + (alvo - inicio) * p) * this.effectiveVolume(), 0, 1);
    }, 40);
    this.rampasDeVolume.set(slot, id);
  }

  // ── Ticker ─────────────────────────────────────────────────────

  private tick = (): void => {
    this.rafId = null;
    if (!this.playing) return;
    try {
      this.emit('timeupdate', { position: this.getPosition(), duration: this.getDuration() });
      this.garantirSaidaAudivel();
    } finally {
      // O próximo quadro é agendado MESMO se um ouvinte (ou o invariante) lançar:
      // uma exceção aqui parava o ticker de vez — progresso, temporizador de fim
      // e preload congelavam com a música ainda tocando, e nada o religava
      // enquanto `playing` seguisse true.
      if (this.playing && this.rafId === null) this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private masterAte = 0;
  private ultimaConferencia = 0;
  private ultimaPosConferida = -1;
  private ultimoResumeDoInvariante = 0;
  private ultimaCorrecaoPorMotivo = new Map<MotivoDeCorrecao, number>();

  /**
   * SE O TEMPO ANDA, A SAÍDA TEM QUE ESTAR AUDÍVEL — e se não está, conserta.
   *
   * No computador o `currentTime` do elemento anda INDEPENDENTE de haver som: o
   * áudio passa por contexto -> trim -> fade -> master, e qualquer elo pode
   * calar sem avisar (contexto suspenso por troca de dispositivo de saída ou
   * política do navegador, ganho de fade preso em 0 por uma rampa cancelada no
   * meio de uma troca rápida, elemento mudo). Os caminhos que já retomavam o
   * contexto (`load`, `startSlot`, ticker oculto) só rodam em momentos
   * específicos; depois deles nada olhava de novo, e o contador seguia
   * contando em silêncio.
   *
   * Roda dentro do tick/ticker que já existem (nenhum temporizador novo) e só
   * olha quando a posição de fato avançou, no máximo a cada 400 ms. Cada
   * correção deixa rastro em `correcoesDeSaida` (telemetria `aoVivo`).
   *
   * NO CELULAR não há contexto (`SEM_GRAFO_WEB_AUDIO`): as checagens de contexto
   * e de ganho se desligam sozinhas por `this.ctx === null`, e o que sobra
   * (mudo e volume do próprio elemento) não toca em Web Audio.
   */
  private garantirSaidaAudivel(): void {
    if (!this.playing || this.destroyed) return;
    const agora = Date.now();
    if (agora - this.ultimaConferencia < 400) return;
    this.ultimaConferencia = agora;

    const slot = this.active;
    const el = this.elementoDeSaida(slot);
    if (!el || el.paused || el.ended) return;
    const pos = el.currentTime;
    const andou = Number.isFinite(pos) && pos > this.ultimaPosConferida + 0.05;
    this.ultimaPosConferida = Number.isFinite(pos) ? pos : -1;
    if (!andou) return;

    const corrigiu = (motivo: MotivoDeCorrecao, det?: string): void => {
      // Um registro por motivo a cada 10 s: o rastro é para achar a causa, não
      // para encher o armazenamento enquanto o navegador recusa um resume().
      const ultimo = this.ultimaCorrecaoPorMotivo.get(motivo) ?? 0;
      if (agora - ultimo < 10_000) return;
      this.ultimaCorrecaoPorMotivo.set(motivo, agora);
      anotarCorrecaoDeSaida(motivo, slot.track?.title, pos, det);
    };

    // O app nunca silencia o elemento (o mudo do usuário vai no `master` ou no
    // volume): `muted` aqui é de fora.
    if (el.muted) {
      el.muted = false;
      corrigiu('mudo');
    }

    const ctx = this.ctx;
    if (ctx) {
      if ((ctx.state as string) !== 'running' && (ctx.state as string) !== 'closed') {
        // Sem laço apertado: se o navegador recusa (sem gesto), tenta de novo em 1 s.
        if (agora - this.ultimoResumeDoInvariante >= 1000) {
          this.ultimoResumeDoInvariante = agora;
          void ctx.resume().catch(() => undefined);
        }
        corrigiu('contexto', String(ctx.state));
        return; // ganho só faz sentido com o contexto andando
      }
      if (slot.fade && slot.mediaSource && (slot.fadeAte ?? 0) < agora) {
        const g = slot.fade.gain.value;
        if (g < 0.99) {
          this.setFade(slot, 1);
          corrigiu('ganho', g.toFixed(2));
        }
      }
      if (this.master && agora > this.masterAte) {
        const alvo = this.effectiveVolume();
        if (Math.abs(this.master.gain.value - alvo) > 0.02) {
          const visto = this.master.gain.value;
          this.master.gain.cancelScheduledValues(ctx.currentTime);
          this.master.gain.setValueAtTime(alvo, ctx.currentTime);
          corrigiu('volume', `master ${visto.toFixed(2)}`);
        }
      }
      // Com grafo o elemento sai sempre a 1; o volume do usuário é do `master`.
      if (slot.mediaSource && el.volume < 0.99) {
        const visto = el.volume;
        el.volume = 1;
        corrigiu('volume', `el ${visto.toFixed(2)}`);
      }
      // A cadeia inteira confere — e o ouvido? O último recurso mede o sinal.
      this.vigiarSilencio(slot, pos, agora, corrigiu);
    }
    // Sem contexto (celular) OU slot fora do grafo: o volume é o do elemento.
    if ((!ctx || !slot.mediaSource) && !this.rampasDeVolume.has(slot)) {
      const alvo = this.effectiveVolume();
      if (Math.abs(el.volume - alvo) > 0.02) {
        const visto = el.volume;
        this.gravarVolume(slot, alvo);
        corrigiu('volume', `el ${visto.toFixed(2)}`);
      }
    }
  }

  private silencioDesde = 0;
  private silencioSeq = -1;
  private amostraDeSinal: Uint8Array<ArrayBuffer> | null = null;

  /**
   * O ÚLTIMO RECURSO: TUDO CONFERE E MESMO ASSIM NÃO SAI SOM.
   *
   * Contexto rodando, ganhos em 1, elemento andando — e o analisador no fim da
   * cadeia lê zero por `SILENCIO_ATE_RENASCER_MS`. É o que acontece com um
   * elemento que o navegador calou por dentro (mídia de outra origem sem CORS
   * capturada pelo grafo; elemento preso a um contexto antigo): nenhum ganho
   * está errado, e nada que se escreva nos nós devolve o som. A única saída é
   * um elemento NOVO: o slot renasce com a mesma faixa, na mesma posição.
   *
   * Uma vez por carga (`renasceu`): se o novo também sair mudo, a causa é outra
   * e um laço de renascimentos só faria a música gaguejar. Não mede com o
   * volume do usuário em zero, nem no meio de uma rampa (o fade subindo é zero
   * legítimo), nem sem grafo — sem analisador não há o que medir.
   */
  private vigiarSilencio(
    slot: Slot,
    pos: number,
    agora: number,
    corrigiu: (motivo: MotivoDeCorrecao, det?: string) => void,
  ): void {
    const analisador = this._analyser;
    if (!analisador || !slot.mediaSource) return;
    if (typeof analisador.getByteTimeDomainData !== 'function') return;
    if (this.silencioSeq !== slot.seq) {
      this.silencioSeq = slot.seq;
      this.silencioDesde = 0;
    }
    if (this.effectiveVolume() < 0.05 || (slot.fadeAte ?? 0) > agora || agora < this.masterAte) {
      this.silencioDesde = 0;
      return;
    }
    const n = analisador.fftSize || 2048;
    if (!this.amostraDeSinal || this.amostraDeSinal.length !== n) {
      this.amostraDeSinal = new Uint8Array(new ArrayBuffer(n));
    }
    analisador.getByteTimeDomainData(this.amostraDeSinal);
    let nivel = 0;
    for (let i = 0; i < n; i++) {
      const desvio = Math.abs((this.amostraDeSinal[i] ?? 128) - 128);
      if (desvio > nivel) nivel = desvio;
    }
    if (nivel >= LIMIAR_DE_SINAL) {
      this.silencioDesde = 0;
      return;
    }
    if (!this.silencioDesde) {
      this.silencioDesde = agora;
      return;
    }
    if (agora - this.silencioDesde < SILENCIO_ATE_RENASCER_MS || slot.renasceu) return;
    corrigiu('silencio', `nível ${nivel} por ${Math.round((agora - this.silencioDesde) / 1000)}s`);
    this.renascer(slot, pos);
  }

  /** O slot ativo recomeça num elemento novo, com a mesma faixa, no mesmo ponto. */
  private renascer(slot: Slot, pos: number): void {
    const track = slot.track;
    const url = slot.url;
    if (!track || !url) return;
    this.silencioDesde = 0;
    const mudo = this.elementoDeSaida(slot);
    // `resetSlot` devolve o elemento mudo ao estoque do Howler — que tira sempre
    // do FIM, ou seja, pegaria o MESMO elemento de volta (medido: o slot
    // renascia no elemento que acabara de calar). Ele sai do estoque, e um
    // elemento novo, com CORS, entra no fim: é esse que o próximo Howl pega.
    this.resetSlot(slot);
    try {
      const pool = (Howler as unknown as HowlerInternals)._html5AudioPool;
      if (Array.isArray(pool)) {
        const i = mudo ? pool.indexOf(mudo) : -1;
        if (i >= 0) pool.splice(i, 1);
        const novo = new Audio() as HTMLAudioElement & { _unlocked?: boolean };
        novo.crossOrigin = 'anonymous';
        novo._unlocked = true;
        pool.push(novo);
      }
    } catch {
      /* sem estoque: o Howler cria um elemento, e `garantirEstoqueComCors` o marca */
    }
    // O 'load' do novo Howl posiciona e toca (ver `inicioAoCarregar` em `prepareHowlSlot`).
    this.prepareSlot(slot, track, url);
    slot.renasceu = true;
    slot.inicioAoCarregar = Math.max(0, pos);
    this.setFade(slot, 1);
    this.applyRate(slot);
    this.applyTrim(slot);
  }

  private syncTicker(): void {
    if (this.playing) {
      this.rafId ??= requestAnimationFrame(this.tick);
      // rAF freezes in background tabs — keep a coarse heartbeat for
      // play-recording / gapless preload triggers.
      this.hiddenTicker ??= setInterval(() => {
        if (this.playing && document.hidden) {
          // MANTER O CONTEXTO VIVO COM A TELA APAGADA.
          //
          // `startSlot` já retoma o contexto ao começar a faixa, mas o navegador
          // o RE-SUSPENDE pouco depois quando a aba está em segundo plano — a
          // faixa nova tocava um segundo e emudecia, e o usuário tinha que
          // acender a tela para o áudio voltar. Retomar aqui, a cada segundo,
          // recupera o som sozinho sem ninguém tocar em nada. `resume()` é
          // permitido porque a reprodução começou com um gesto do usuário.
          if (this.ctx && this.ctx.state === 'suspended') {
            void this.ctx.resume().catch(() => undefined);
          }
          this.emit('timeupdate', { position: this.getPosition(), duration: this.getDuration() });
          this.garantirSaidaAudivel();
        }
      }, 1000);
    } else {
      this.stopTicker();
    }
  }

  private stopTicker(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.hiddenTicker !== null) clearInterval(this.hiddenTicker);
    this.hiddenTicker = null;
  }

  private handleVisibility = (): void => {
    if (!document.hidden) {
      // Some browsers suspend the AudioContext in the background — resume so
      // playback (and lock-screen controls) recover on return.
      if (this.playing) void this.ctx?.resume().catch(() => undefined);
      this.syncTicker();
    }
  };

  private handleEnded(): void {
    this.playing = false;
    this.syncTicker();
    this.emit('ended', { track: this.active.track });
  }

  /**
   * Howler creates pooled <audio> elements without crossOrigin, which taints
   * the Web Audio graph. Seed the pool with a CORS-enabled element so the
   * next Howl picks it up.
   */
  /**
   * NUNCA PÕE ELEMENTO TRAVADO NO ESTOQUE.
   *
   * Isto empurrava um `new Audio()` CRU para o topo do estoque do Howler a cada
   * faixa carregada — e o Howler pega sempre o do topo. No iPhone, um elemento
   * que nunca passou por um toque só toca DENTRO de um toque: a próxima faixa
   * da fila, a carga que termina depois do clique, a retomada — tudo recusado
   * ("o iPhone está bloqueando a reprodução"). O estoque agora só recebe
   * elementos destravados, e é reabastecido a cada toque (`abastecerEstoque`).
   */
  private primeHtml5Pool(): void {
    /* ver `abastecerEstoque` e `garantirEstoqueComCors` */
  }

  /**
   * NO COMPUTADOR, TODO ELEMENTO QUE O HOWLER PEGAR TEM QUE SER CORS.
   *
   * O Howler abastece o estoque sozinho no primeiro toque (`new Audio()` cru,
   * SEM `crossOrigin`) e tira sempre do FIM — onde o nosso `abastecerEstoque`
   * não põe nada (ele entra pela frente). Resultado: as faixas de rede nasciam
   * em elementos sem CORS, entravam no grafo e saíam MUDAS com o tempo
   * correndo. Marcar o `crossOrigin` num elemento ocioso é seguro (o `src` só é
   * posto no `new Howl`); e quando o estoque está vazio o Howler cria um cru, então
   * entra um CORS no lugar. No celular o grafo não existe e o CORS só poderia
   * quebrar fonte sem cabeçalho: ali não se toca em nada.
   */
  private garantirEstoqueComCors(): void {
    if (SEM_GRAFO_WEB_AUDIO || this.webAudioFailed) return;
    try {
      const pool = (Howler as unknown as HowlerInternals)._html5AudioPool;
      if (!Array.isArray(pool)) return;
      for (const el of pool) {
        if (el.crossOrigin !== 'anonymous') el.crossOrigin = 'anonymous';
      }
      if (pool.length === 0) {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        pool.push(el);
      }
    } catch {
      /* no pior caso o guarda de `connectSlotElement` deixa o elemento fora do grafo */
    }
  }

  /**
   * ESTOQUE DE ELEMENTOS DESTRAVADOS, reabastecido DENTRO de cada gesto.
   *
   * O `load()` chamado durante um toque é o que o iOS aceita como destravar um
   * elemento (é o mesmo truque do `_unlockAudio` do Howler — que só roda uma
   * vez por sessão; com duas faixas por troca e a pré-carga da próxima, o
   * estoque dele acabava e o Howler criava elementos travados). Mantido cheio
   * a cada toque, toda faixa nasce num elemento que pode tocar fora do gesto.
   */
  abastecerEstoque = (): void => {
    try {
      const howler = Howler as unknown as HowlerInternals & {
        _releaseHtml5Audio?: (el: HTMLAudioElement) => void;
      };
      const pool = howler._html5AudioPool;
      if (!Array.isArray(pool)) return;
      while (pool.length < ESTOQUE_DESTRAVADO) {
        const el = new Audio() as HTMLAudioElement & { _unlocked?: boolean };
        el.crossOrigin = 'anonymous';
        el._unlocked = true;
        el.load();
        pool.unshift(el);
      }
    } catch {
      /* não crítico: no pior caso, o Howler cria um elemento como antes */
    }
  };
}

/** The one engine instance the whole app shares. */
export const audioEngine = AudioEngine.getInstance();
