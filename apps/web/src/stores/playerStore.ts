/**
 * playerStore — global playback state (ARCHITECTURE.md §10).
 *
 * The store is the only consumer of AudioEngine events; components never talk
 * to the engine directly (except read-only visualizer access to `analyser`).
 * Bootstrap once with `initPlayerEngine()` from App.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaySource, RecordPlayInput, RepeatMode, TrackDto } from '@aurial/shared';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { initMediaSession } from '@/lib/audio/mediaSession';
import { api } from '@/lib/api';
import { subscribeAuth } from '@/lib/firebase';
import * as localHistory from '@/lib/local/localHistory';
import { clamp } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  hydrateDownloads,
  localAudioUrl,
  rebaixarAoFalhar,
} from '@/features/downloads/downloadManager';
import {
  ensureLocalAudioUrl,
  hasLocalAudio,
  hydrate as hydrateLocalLibrary,
  localAudioUrl as localLibraryAudioUrl,
  remoteUrlFor,
  reportDeadRemote,
  setTrackDuration,
  sourceUrlFor,
} from '@/lib/local/localLibrary';
import { garantirDetalhe, informarFila } from '@/lib/local/detalheDaFaixa';
import * as faixasQueFalharam from '@/lib/local/faixasQueFalharam';
import { buildStreamUrl, importerHostLabel } from '@/lib/local/importerHelper';

/** Faixas cuja duração já foi escrita de volta nesta sessão — o 'timeupdate'
 *  dispara várias vezes por segundo e a gravação é em disco. */
const duracaoJaAnotada = new Set<string>();

/**
 * A duração real, medida pelo elemento de áudio, volta para a biblioteca.
 *
 * É o conserto de um dado que se perdeu na importação e que nada revisitava:
 * sem ele a faixa mostra "0:00" e perde o caminho exato da busca de letra, que
 * casa por duração. Ver `setTrackDuration` em lib/local/localLibrary.ts — é lá
 * que mora a regra de nunca sobrescrever duração boa.
 */
function anotarDuracaoMedida(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 1) return;
  const atual = usePlayerStore.getState().currentTrack;
  if (!atual || duracaoJaAnotada.has(atual.id)) return;
  if ((atual.durationMs ?? 0) > 0) return;
  duracaoJaAnotada.add(atual.id);
  try {
    setTrackDuration(atual.id, duration * 1000);
  } catch {
    /* metadata nunca interrompe a reprodução */
  }
}
import { nextAudiusHost } from '@/lib/catalog/audius';
import { streamUrlFor } from '@/lib/catalog/map';

/** Origem (scheme+host) de uma URL, para saber quais nós já falharam. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Ensure a track has a playable source. Local-library tracks store their audio
 * only on the device that imported them; on any OTHER device (metadata synced,
 * audio absent) we resolve a stream: the uploaded copy on the importer if it
 * exists, else a live stream from the original link (YouTube/SoundCloud/…) or
 * the direct file URL. Returns the track augmented with a `streamUrl`, or the
 * track unchanged when nothing can be resolved (genuinely unavailable).
 */
async function ensurePlayableSource(track: TrackDto): Promise<TrackDto> {
  // `hasLocalAudio` responde sem abrir o arquivo. Vale checar aqui também:
  // uma faixa com áudio no aparelho JAMAIS pode acabar buscando a rede só
  // porque o object URL ainda não tinha sido criado.
  if (hasLocalAudio(track.id)) {
    await ensureLocalAudioUrl(track.id);
    return track;
  }
  if (localLibraryAudioUrl(track.id) || localAudioUrl(track.id) || track.streamUrl) return track;
  if (!track.id.startsWith('local:')) return track;
  // OFFLINE: nunca sai atrás de rede — sem áudio local, a faixa é indisponível.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return track;
  // ENTRADA MAGRA: a listagem do acervo não traz mais URL nenhuma, só o bit que
  // diz que a faixa toca. É AQUI, no caminho do play, que o conteúdo é buscado
  // — uma faixa por vez, no clique, em vez de cinco mil na abertura. Quando o
  // assimilador já passou por ela (o caso comum), isto volta na hora, sem rede.
  if (!remoteUrlFor(track.id) && !sourceUrlFor(track.id)) await garantirDetalhe(track.id);
  const remote = remoteUrlFor(track.id);
  if (remote) return { ...track, streamUrl: remote };
  const sourceUrl = sourceUrlFor(track.id);
  if (!sourceUrl) return track;
  try {
    const host = new URL(sourceUrl).hostname;
    if (importerHostLabel(host)) {
      const streamUrl = await buildStreamUrl(sourceUrl);
      return streamUrl ? { ...track, streamUrl } : track;
    }
    return { ...track, streamUrl: sourceUrl }; // direct-file import
  } catch {
    return track;
  }
}

/**
 * Próxima fonte para uma faixa local cuja fonte ATUAL morreu — o cofre de blobs
 * pode ter evictado a cópia (LRU), estar fora do ar, ou a URL de /stream trazer
 * um token Firebase expirado (gravado na fila/retomada de uma sessão anterior).
 * Tenta, nesta ordem, o que ainda não foi tentado nesta carga: a cópia enviada
 * (remoteUrl) → stream ao vivo da fonte com token NOVO → o link direto.
 * Devolve a faixa com a nova fonte, ou null quando não há mais o que tentar.
 */
async function resolveNextSource(track: TrackDto, tried: Set<string>): Promise<TrackDto | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  // Faixa de catálogo: a streamUrl foi gravada com o nó de descoberta da vez.
  // Se ESSE nó caiu, todas as faixas parecem mortas — rotaciona para outro nó
  // e reescreve a URL em vez de declarar a faixa indisponível.
  if (track.id.startsWith('audius:')) {
    const audiusId = track.id.slice('audius:'.length);
    const triedHosts = [...tried].map(hostOf).filter((h): h is string => h !== null);
    for (let i = 0; i < 2; i++) {
      const host = await nextAudiusHost(triedHosts);
      if (!host) return null;
      const url = streamUrlFor(audiusId, host);
      if (!tried.has(url)) return { ...track, streamUrl: url, downloadUrl: url };
      triedHosts.push(host);
    }
    return null;
  }
  if (!track.id.startsWith('local:')) return null;
  const remote = remoteUrlFor(track.id);
  if (remote && !tried.has(remote)) return { ...track, streamUrl: remote };
  const sourceUrl = sourceUrlFor(track.id);
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname;
    if (importerHostLabel(host)) {
      const streamUrl = await buildStreamUrl(sourceUrl); // token sempre fresco
      return streamUrl && !tried.has(streamUrl) ? { ...track, streamUrl } : null;
    }
    return tried.has(sourceUrl) ? null : { ...track, streamUrl: sourceUrl };
  } catch {
    return null;
  }
}

export interface PlayContext {
  source: PlaySource;
  sourceId?: string;
}

export interface PlayerState {
  currentTrack: TrackDto | null;
  queue: TrackDto[];
  queueIndex: number;
  /** Pre-shuffle order, restored when shuffle turns off. */
  originalQueue: TrackDto[];
  isPlaying: boolean;
  /** Seconds. */
  progress: number;
  /** Seconds. */
  duration: number;
  /** Seconds buffered past the playhead (seek-bar underlay). */
  buffered: number;
  /** 0..1 — persisted. */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  playbackRate: number;
  isBuffering: boolean;
  context: PlayContext | null;

  playTrack: (track: TrackDto, context?: PlayContext) => void;
  playQueue: (tracks: TrackDto[], startIndex?: number, context?: PlayContext) => void;
  /** Jump to a queue position (QueuePanel click). */
  playAt: (index: number) => void;
  next: () => void;
  prev: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (tracks: TrackDto | TrackDto[]) => void;
  playNext: (tracks: TrackDto | TrackDto[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  /** Replace everything after the current track (drag-reorder in QueuePanel). */
  setUpNext: (tracks: TrackDto[]) => void;
  clearQueue: () => void;
  setRate: (rate: number) => void;
}

/**
 * Seam for the features layer: called after a play is recorded
 * (analytics, history invalidation…). The API POST itself stays here.
 */
let onPlayRecorded: ((input: RecordPlayInput) => void) | null = null;
export function setOnPlayRecorded(callback: ((input: RecordPlayInput) => void) | null): void {
  onPlayRecorded = callback;
}

// Local caches (library Cache Storage + downloads IndexedDB) rebuilt — await
// before choosing a playback source so local audio always wins over network.
// Cada hydrate é blindado: se um deles rejeitar (Cache Storage indisponível,
// IndexedDB bloqueado), a promise memoizada NÃO pode ficar rejeitada para
// sempre — todo load aguarda por ela, e uma rejeição eterna mataria TODA a
// reprodução em silêncio.
// Hidratadas em SEPARADO (não mais um Promise.all único) porque a biblioteca
// local sozinha já mede até ~3s de boot com uma coleção grande (ver o
// comentário em cima de `indexarAudioLocal`, em localLibrary.ts) — e ISSO
// segurava toda faixa nova, mesmo faixas de catálogo/Audius que jamais têm
// entrada na biblioteca local. Era uma fatia real do "demora demais" do
// usuário: 3s de espera à toa antes de sequer pedir a URL de stream.
let hydrateLibraryPromise: Promise<unknown> | null = null;
function localLibraryReady(): Promise<unknown> {
  return (hydrateLibraryPromise ??= hydrateLocalLibrary().catch(() => undefined));
}
let hydrateDownloadsPromise: Promise<unknown> | null = null;
function downloadsReady(): Promise<unknown> {
  return (hydrateDownloadsPromise ??= hydrateDownloads().catch(() => undefined));
}
/** Ambas — usado só no pré-aquecimento do boot, fora do caminho de carga. */
function localAudioReady(): Promise<unknown> {
  return Promise.all([localLibraryReady(), downloadsReady()]);
}
/**
 * O que este ID PODE precisar do cofre local antes de tocar: a biblioteca
 * local só guarda faixas `local:` (ver `localLibrary.ts`), então esperar por
 * ela para uma faixa de catálogo é espera pura. Downloads offline valem para
 * qualquer faixa — esses sempre esperamos.
 */
function localSourcesReady(trackId: string): Promise<unknown> {
  return trackId.startsWith('local:')
    ? Promise.all([localLibraryReady(), downloadsReady()])
    : downloadsReady();
}

// Per-loaded-track flags (reset on every load).
let playRecorded = false;
let preloadRequested = false;
let crossfadeTriggered = false;
let lastProgressCommit = 0;
let syntheticEndHandledTrackId: string | null = null;

// ── avanço de faixa com a tela apagada ───────────────────────────
// O avanço tinha DUAS pernas, e as duas dependem de o navegador nos dar
// atenção: o evento 'ended' do elemento e o polling de `timeupdate`. Com a
// tela desligada o Android estrangula temporizador repetido — o heartbeat de
// 1s vira um a cada minuto ou some — e o fim da faixa passava batido: a música
// acabava e ficava tudo em silêncio até o usuário acender a tela.
//
// Esta é a terceira perna: UM temporizador só, armado quando a faixa carrega e
// mirado no instante em que ela deve acabar. Timer único e distante sobrevive
// ao estrangulamento muito melhor que polling de 1s, e o navegador mantém
// temporizadores de página com áudio audível.
//
// Ele nunca é a via principal — só age se as outras duas não agiram, e a
// guarda por id de faixa impede pular duas vezes a mesma.
let endTimer: ReturnType<typeof setTimeout> | null = null;
let endTimerTrackId: string | null = null;
/** Folga depois do fim teórico: o 'ended' de verdade tem preferência. */
const END_TIMER_SLACK_MS = 1200;

function clearEndTimer(): void {
  if (endTimer !== null) clearTimeout(endTimer);
  endTimer = null;
  endTimerTrackId = null;
}

// ── troca de faixa com a TELA APAGADA (a causa central deste conserto) ────
// O avanço padrão (gapless, crossfade=0) só começa a próxima faixa DEPOIS que a
// atual chega ao fim — no evento 'ended'. Naquele instante o elemento que
// tocava já parou e o próximo ainda não começou: existe um vão de silêncio.
//
// Com a tela apagada esse vão é fatal. O sistema operacional entende o silêncio
// como "este app parou de tocar" e desativa a sessão de mídia da página; aí o
// play() do próximo elemento é RECUSADO (política de autoplay em segundo plano),
// e no iPhone o processo é suspenso logo depois do 'ended' — nada mais roda até
// o usuário acender a tela. Era por isso que a música parava e só a próxima só
// começava ao ligar a tela.
//
// A cura é não deixar a sessão cair: começar a próxima faixa um instante ANTES
// de a atual acabar, enquanto o áudio AINDA está saindo. O play() do próximo
// vira uma CONTINUAÇÃO de uma sessão ativa — e isso o sistema permite, tanto no
// Android quanto no iOS. Fazemos isso só com a tela apagada; no primeiro plano o
// 'ended' nativo entrega gapless perfeito e não há por que encurtar a faixa.
//
// O gatilho é UM temporizador só, mirado em ~LEAD antes do fim e (re)armado
// quando a faixa carrega, quando o playhead se move e quando a tela apaga.
// Temporizador único sobrevive ao estrangulamento de segundo plano muito melhor
// que polling; e a página, com áudio audível, mantém temporizadores vivos.
let handoffTimer: ReturnType<typeof setTimeout> | null = null;
let handoffDoneTrackId: string | null = null;
/** Antecedência da troca: começa a próxima ~0,9s antes do fim da atual. */
const BG_HANDOFF_LEAD_MS = 900;
/** Blend curtíssimo no Android (via grafo Web Audio); no iOS a troca é seca. */
const BG_HANDOFF_XF = 0.4;

function clearHandoffTimer(): void {
  if (handoffTimer !== null) clearTimeout(handoffTimer);
  handoffTimer = null;
}

/**
 * Ponte para as ações da store, que são criadas ANTES de `initPlayerEngine`
 * existir. Fica nula até o engine subir — nos testes que não inicializam o
 * engine, buscar simplesmente não remarca nada.
 */
let rearmEndTimer: (() => void) | null = null;

// ── fonte morta não mata a faixa ─────────────────────────────────
// URLs já tentadas na carga ATUAL (a primeira falha entra aqui) + quantas
// alternativas já foram atrás. Zerado a cada troca de faixa (loadIndex).
let fallbackTried = new Set<string>();
let fallbackAttempts = 0;
const MAX_FALLBACK_ATTEMPTS = 3;

// Carregamento pendurado (ex.: /stream ao vivo que nunca emite bytes) não gera
// evento de erro nenhum — sem watchdog a faixa fica "carregando" para sempre.
//
// SESSENTA, NÃO TRINTA. O cofre passou a se refazer: quando a poda levou os
// bytes, o importador reextrai a faixa da origem sob o mesmo token, e isso leva
// 20 a 25 segundos medidos em produção — mais em rede de celular. Com o teto em
// 30s o watchdog matava a reprodução no meio da reconstrução e a faixa que
// estava a segundos de tocar era declarada morta.
//
// O custo de errar para cada lado não é simétrico: esperar 30s a mais numa
// faixa genuinamente quebrada é chato; desistir de uma que ia tocar é perder a
// música. Quem realmente não existe responde 404 na hora e nem chega aqui.
const LOAD_WATCHDOG_MS = 60_000;
// Faixas de catálogo (Audius) e streams diretos NÃO passam pela reextração do
// cofre — quem não respondeu em ~18s está morta de verdade (host caído, CORS
// bloqueado sem nem gerar 'error'), não "reconstruindo". Usar os mesmos 60s
// do cofre nelas era a própria causa da demora: o spinner girava um minuto
// inteiro antes de sequer tentar o próximo nó do Audius.
const CATALOG_LOAD_WATCHDOG_MS = 18_000;
// Depois que a faixa JÁ tocou, checagens mais curtas detectam travamento no
// meio (o elemento emite 'waiting' e nunca mais volta) — antes disso o player
// ficava eternamente no spinner sem nenhum erro.
const STALL_CHECK_MS = 10_000;

/** Só faixa local passa pela reextração de 20-25s do cofre — dá o teto de
 *  60s só a ela. Qualquer outra fonte usa o teto curto. */
function initialWatchdogMs(trackId: string): number {
  return trackId.startsWith('local:') ? LOAD_WATCHDOG_MS : CATALOG_LOAD_WATCHDOG_MS;
}
let loadWatchdog: ReturnType<typeof setTimeout> | null = null;
let lastWatchdogPos = -1;
let stallStrikes = 0;

function clearLoadWatchdog(): void {
  if (loadWatchdog !== null) clearTimeout(loadWatchdog);
  loadWatchdog = null;
  lastWatchdogPos = -1;
  stallStrikes = 0;
}

/**
 * SONDA A CÓPIA EM PARALELO COM O CARREGAMENTO — e por que isso vale um pedido.
 *
 * Descobrir que a cópia morreu ESPERANDO o elemento de áudio desistir custava
 * ~4,5 s por faixa (medido: seis mortas seguidas levaram 27 s até sair som).
 * O elemento nem chega a registrar erro — ele fica em readyState 0 até um
 * temporizador lá em cima concluir que não vem nada.
 *
 * Um `Range: bytes=0-0` responde em ~300 ms e é conclusivo: o cofre devolve
 * 404/403 quando não tem o que servir. Rodando junto com o `load`, a faixa
 * morta é descartada quase na hora e a fila anda; a faixa viva não paga nada
 * além de um byte, e o `load` que já estava em curso continua normalmente.
 *
 * 404/403 = morte é a MESMA regra de `reportDeadRemote`; qualquer outra
 * resposta (inclusive demora e erro de rede) não prova nada e é ignorada — é o
 * cofre reconstruindo, e quem manda nesse caso continua sendo o watchdog.
 */
function sondarFonteEmParalelo(track: TrackDto, index: number): void {
  const url = track.streamUrl;
  if (!url || !/^https?:/.test(url)) return;
  void (async () => {
    let morta = false;
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      morta = res.status === 404 || res.status === 403;
    } catch {
      return; // rede caiu / CORS: não é prova de nada
    }
    if (!morta) return;
    const s = usePlayerStore.getState();
    // A sonda é velha se o usuário já trocou de faixa — ou se, contra todas as
    // probabilidades, esta começou a tocar mesmo assim. Nunca cortar som.
    if (s.queueIndex !== index || s.currentTrack?.id !== track.id) return;
    if (audioEngine.getPosition() > 0) return;
    clearLoadWatchdog();
    const handled = await attemptSourceFallback(s.currentTrack ?? track);
    if (handled) return;
    failCurrentTrack('Faixa indisponível.');
  })();
}

// Uma faixa morta no meio da fila NÃO pode parar a música (Spotify pula e
// segue). Zerado quando sai som de verdade.
let consecutiveDeadTracks = 0;
/** Quando começou a sequência de mortes em curso (0 = não há sequência). */
let deadRunStartedAt = 0;

/**
 * ATÉ ONDE O PLAYER ANDA ATRÁS DE SOM — e por que virou tempo, não contagem.
 *
 * O teto antigo era três mortes seguidas. Ele existia por um motivo certo:
 * numa queda geral (sem rede, cofre fora do ar) TODA faixa falha, e varrer a
 * fila inteira seria trocar um erro honesto por um loop de pulos. Mas ele
 * supunha que faixa morta fosse exceção — e deixou de ser: com boa parte das
 * cópias do cofre podada, três mortes seguidas é rotina estatística, e o player
 * desistia no meio de uma fila que tinha música viva logo adiante.
 *
 * Tempo separa os dois casos, e contagem não separa. Uma sequência ruim de
 * faixas custa uma ida à rede por faixa e o player atravessa dezenas dentro do
 * orçamento; uma queda geral estoura o orçamento sem nunca produzir som, e aí
 * parar é a resposta certa. O teto de contagem fica só como trava contra falha
 * INSTANTÂNEA (que não consome tempo) virar laço quente de CPU.
 */
const DEAD_RUN_BUDGET_MS = 20_000;
const MAX_DEAD_TRACK_SKIPS = 40;

/** Zera a sequência de mortes — só quem produz som de verdade chama isto. */
function resetDeadRun(): void {
  consecutiveDeadTracks = 0;
  deadRunStartedAt = 0;
}

/**
 * ANOTA O CASO — aqui, e não antes.
 *
 * Este é o funil ÚNICO de morte do player: só se chega nele depois de a cadeia
 * inteira de fontes ter sido tentada e esgotada. Registrar mais cedo encheria o
 * mapa de faixas que a tentativa seguinte resolveu, e um mapa cheio de casos
 * falsos é pior que mapa nenhum — ele manda o reparador baixar de novo coisa
 * que já funciona.
 *
 * O motivo sai do estado da cadeia, porque é ele que decide o que fazer depois:
 *  - tinha os BYTES aqui e mesmo assim não tocou → o arquivo é que está ruim,
 *    e baixar de novo é exatamente o conserto certo;
 *  - não tinha NADA para tentar → a faixa não tem conserto por reimportação, e
 *    a resposta honesta é parar de anunciá-la;
 *  - tinha fonte e ela morreu → é o caso comum (cópia podada do cofre), e o
 *    caminho de volta é o `sourceUrl`.
 */
function registrarNoMapa(track: TrackDto | null): void {
  if (!track) return;
  try {
    const audioLocal = hasLocalAudio(track.id);
    const remota = Boolean(remoteUrlFor(track.id));
    const origem = sourceUrlFor(track.id);
    const motivo = audioLocal
      ? 'erro-de-midia'
      : !remota && !origem && !track.streamUrl
        ? 'sem-fonte'
        : 'fonte-morta';
    faixasQueFalharam.registrar(track, motivo, {
      tinhaAudioLocal: audioLocal,
      tinhaCopiaRemota: remota,
      sourceUrl: origem ?? undefined,
    });
  } catch {
    // Diagnóstico NUNCA pode derrubar a reprodução: se o registro falhar (cota
    // cheia, armazenamento bloqueado), o player segue pulando como sempre fez.
  }
}

/**
 * Fim da linha para a faixa ATUAL (todas as fontes falharam): se a fila tem
 * próxima e estávamos tocando, PULA para ela em vez de parar tudo.
 *
 * O AVISO SAI UMA VEZ POR SEQUÊNCIA, não por faixa. Um toast a cada pulo
 * transformava a travessia de uma sequência ruim numa pilha de reclamações na
 * tela — barulho sobre um problema que o app já está resolvendo sozinho.
 */
function failCurrentTrack(message: string): void {
  const s = usePlayerStore.getState();
  registrarNoMapa(s.currentTrack);
  consecutiveDeadTracks++;
  if (deadRunStartedAt === 0) deadRunStartedAt = Date.now();

  const hasNext = s.queueIndex + 1 < s.queue.length || (s.repeat === 'all' && s.queue.length > 1);
  // SEM REDE não é sequência ruim, é queda geral: parar na primeira é honesto e
  // poupa a fila inteira de tentativas que já se sabe que vão falhar.
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const dentroDoOrcamento =
    Date.now() - deadRunStartedAt < DEAD_RUN_BUDGET_MS &&
    consecutiveDeadTracks <= MAX_DEAD_TRACK_SKIPS;

  if (s.isPlaying && online && dentroDoOrcamento) {
    if (consecutiveDeadTracks === 1) {
      const title = s.currentTrack?.title ?? 'faixa';
      void import('sonner').then(({ toast }) => toast(`"${title}" indisponível — pulando.`));
    }
    if (hasNext) {
      s.next();
      return;
    }
    // FILA DE UMA FAIXA SÓ e ela morreu. Parar aqui era exatamente o silêncio
    // na cara de quem clicou numa música avulsa — e o app JÁ promete uma rádio
    // de parecidas nesse fluxo (ver `playTrack`), só que montada em segundo
    // plano: quando a semente morre antes de a rádio chegar, não havia para
    // onde ir. Antecipa a rádio AGORA, para que dar play sempre acabe em som.
    void continuarNumaParecida(s.currentTrack, message);
    return;
  }
  pararComErro(message);
}

function pararComErro(message: string): void {
  usePlayerStore.setState({ isPlaying: false, isBuffering: false });
  void import('sonner').then(({ toast }) => toast.error(message));
}

/**
 * A semente morreu e a fila acabou: emenda numa parecida em vez de calar.
 *
 * Usa a MESMA rádio que `playTrack` monta em segundo plano — não é um caminho
 * novo de recomendação, é o mesmo, antecipado para o momento em que ele faz
 * falta. Se não houver parecida nenhuma, aí sim para e avisa: inventar som que
 * não tem a ver com o pedido seria pior do que a verdade.
 */
async function continuarNumaParecida(morta: TrackDto | null, message: string): Promise<void> {
  if (!morta) {
    pararComErro(message);
    return;
  }
  try {
    const { construirRadio } = await import('@/lib/reco/radio');
    const similares = construirRadio(morta).filter((t) => t.id !== morta.id);
    const st = usePlayerStore.getState();
    if (st.currentTrack?.id !== morta.id) return; // o usuário já trocou de faixa
    if (similares.length === 0) {
      pararComErro(message);
      return;
    }
    const fila = [morta, ...similares];
    usePlayerStore.setState({ queue: fila, originalQueue: fila });
    usePlayerStore.getState().next();
  } catch {
    pararComErro(message);
  }
}

// ── retomar de onde parou (Spotify-like) ────────────────────────
// Ao reabrir o app, a ÚLTIMA faixa volta pausada na posição exata.
// Persistência leve: só {faixa, segundos} — nunca a fila inteira (stringify
// de fila grande já congelou o app uma vez).
const RESUME_KEY = 'aurial:resume';
let lastResumeSave = 0;
/** Posição a buscar assim que o engine carregar a faixa restaurada. */
let pendingResumeSeek: number | null = null;

/**
 * "Quando esta faixa terminar de carregar, comece nesta posição."
 *
 * Precisa ser assim, e não um `seek()` logo depois do `playTrack()`: enquanto o
 * áudio não carregou não existe linha do tempo para buscar, e o seek se perde
 * em silêncio. É o que faz "trazer a reprodução para cá" cair no segundo certo
 * em vez de recomeçar a música.
 */
export function resumeAt(seconds: number): void {
  pendingResumeSeek = seconds > 0 ? seconds : null;
}

function saveResume(force = false): void {
  const s = usePlayerStore.getState();
  if (!s.currentTrack || s.progress <= 0) return;
  const now = Date.now();
  if (!force && now - lastResumeSave < 5_000) return; // no máx. 1 escrita / 5s
  lastResumeSave = now;
  try {
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ track: s.currentTrack, progress: Math.floor(s.progress) }),
    );
  } catch {
    /* quota */
  }
}

/**
 * Grava a retomada com a marca de "volte TOCANDO" — usado só quando uma versão
 * nova vai recarregar a página com a música no ar. No próximo boot, em vez de
 * voltar pausada (o padrão), a faixa retoma sozinha de onde estava. É uma marca
 * de uso único: o primeiro boot que a lê já a apaga, para uma reabertura comum
 * depois não sair tocando sem o usuário pedir.
 */
export function prepararRetomadaTocando(): void {
  const s = usePlayerStore.getState();
  if (!s.currentTrack) return;
  try {
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ track: s.currentTrack, progress: Math.floor(s.progress), tocando: true }),
    );
  } catch {
    /* quota */
  }
}

function readResume(): { track: TrackDto; progress: number; tocando?: boolean } | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? 'null');
    const saved = parsed as { track?: TrackDto; progress?: number; tocando?: boolean } | null;
    return saved?.track
      ? { track: saved.track, progress: saved.progress ?? 0, tocando: saved.tocando === true }
      : null;
  } catch {
    return null;
  }
}

// ── prévia de 30s para visitantes ────────────────────────────────
// Sem login, cada faixa toca só PREVIEW_SECONDS; ao bater o limite o player
// pausa e convida a criar conta (uma vez por faixa carregada).
const PREVIEW_SECONDS = 30;
let signedIn = false;
let previewGateFired = false;
subscribeAuth((user) => {
  signedIn = user !== null;
});

function firePreviewGate(): void {
  if (previewGateFired) return;
  previewGateFired = true;
  audioEngine.pause();
  usePlayerStore.setState({ isPlaying: false });
  void import('sonner').then(({ toast }) =>
    toast('Crie sua conta para ouvir a música completa', {
      description: 'De graça — sua biblioteca sincroniza em todos os aparelhos.',
      action: {
        label: 'Criar conta',
        onClick: () => {
          window.location.href = '/login';
        },
      },
      duration: 10_000,
    }),
  );
}

/**
 * A fonte atual falhou (ou pendurou): tenta a PRÓXIMA fonte da faixa em vez de
 * desistir. Devolve false só quando não há mais alternativa — aí o chamador
 * para o player e avisa. true = já recarregou com outra fonte (ou a faixa
 * mudou no meio do caminho e não há nada a fazer).
 */
async function attemptSourceFallback(track: TrackDto): Promise<boolean> {
  if (track.streamUrl) {
    fallbackTried.add(track.streamUrl);
    // Se a URL morta era a cópia do cofre, limpa da biblioteca (todos os
    // aparelhos param de tentar o hop morto) e re-envia o áudio se ele
    // existir NESTE aparelho — o cofre se cura sozinho. No-op nos demais casos.
    reportDeadRemote(track.id, track.streamUrl);
  }
  if (fallbackAttempts >= MAX_FALLBACK_ATTEMPTS) return false;
  fallbackAttempts++;
  const resolved = await resolveNextSource(track, fallbackTried);
  const s = usePlayerStore.getState();
  if (s.currentTrack?.id !== track.id) return true; // trocou de faixa — encerra
  if (!resolved?.streamUrl) return false;
  fallbackTried.add(resolved.streamUrl);
  usePlayerStore.setState((st) => ({
    queue: st.queue.map((t, i) => (i === st.queueIndex && t.id === track.id ? resolved : t)),
    currentTrack: resolved,
    isBuffering: true,
  }));
  audioEngine.load(resolved, { autoplay: s.isPlaying });
  armLoadWatchdog(resolved.id, initialWatchdogMs(resolved.id));
  // A fonte antiga apodreceu, mas esta acabou de funcionar: baixa uma cópia
  // LOCAL agora para a próxima reprodução vir do disco e nunca mais tropeçar no
  // link morto. Melhor esforço, em segundo plano — não atrapalha o play atual.
  rebaixarAoFalhar(resolved);
  return true;
}

/** Para de esperar um carregamento que nunca chega: sem 'loaded' nem posição
 *  em 30s, trata como fonte morta e cai para a próxima. Fonte VIVA porém
 *  lenta (bytes chegando — /stream ao vivo num servidor carregado) ganha mais
 *  tempo em vez de ser morta no meio. */
function armLoadWatchdog(trackId: string, delayMs = LOAD_WATCHDOG_MS): void {
  if (loadWatchdog !== null) clearTimeout(loadWatchdog);
  loadWatchdog = null;
  if (typeof window === 'undefined') return;
  loadWatchdog = setTimeout(() => {
    loadWatchdog = null;
    const state = usePlayerStore.getState();
    const current = state.currentTrack;
    if (!current || current.id !== trackId) return;

    const pos = audioEngine.getPosition();

    // ── já tocou: vigia TRAVAMENTO no meio da faixa ────────────────
    if (pos > 0) {
      if (!state.isPlaying) return; // pausado de propósito — nada a vigiar
      // Segunda trava contra briga por áudio: se o engine já sabe que não está
      // tocando, quem parou foi o sistema. O watchdog existe para destravar
      // buffer preso, nunca para tomar o alto-falante de volta de outro app.
      if (!audioEngine.isPlaying) return;
      if (pos !== lastWatchdogPos) {
        lastWatchdogPos = pos; // playhead andando: saudável
        stallStrikes = 0;
        armLoadWatchdog(trackId, STALL_CHECK_MS);
        return;
      }
      // Playhead parado com o player "tocando" = travou.
      stallStrikes++;
      if (stallStrikes === 1) {
        // Primeiro strike: cutuca o elemento (costuma destravar buffer preso).
        audioEngine.seek(pos);
        audioEngine.play();
        armLoadWatchdog(trackId, STALL_CHECK_MS);
        return;
      }
      void (async () => {
        if (await attemptSourceFallback(current)) return;
        failCurrentTrack('A reprodução travou — tentando a próxima faixa.');
      })();
      return;
    }

    // ── ainda não tocou: vigia CARREGAMENTO pendurado ──────────────
    if (audioEngine.getBufferedEnd() > 0) {
      armLoadWatchdog(trackId, initialWatchdogMs(trackId)); // dados chegando — só está lento, espera mais
      return;
    }
    void (async () => {
      if (await attemptSourceFallback(current)) return;
      failCurrentTrack('Não foi possível carregar esta faixa agora.');
    })();
  }, delayMs);
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

/** Shuffle keeping the item at `keepIndex` first. */
function shuffleKeepingFirst(tracks: TrackDto[], keepIndex: number): TrackDto[] {
  const current = tracks[keepIndex];
  const rest = tracks.filter((_, i) => i !== keepIndex);
  const shuffled = fisherYatesShuffle(rest);
  return current ? [current, ...shuffled] : shuffled;
}

function toArray(tracks: TrackDto | TrackDto[]): TrackDto[] {
  return Array.isArray(tracks) ? tracks : [tracks];
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      function applyEngineSettings(): void {
        audioEngine.setVolume(get().volume);
        audioEngine.setMuted(get().muted);
        audioEngine.setRate(get().playbackRate);
      }

      /** Load queue[index] into the engine and sync state. */
      function loadIndex(index: number, autoplay: boolean, crossfadeSeconds = 0): void {
        const track = get().queue[index];
        if (!track) return;
        playRecorded = false;
        preloadRequested = false;
        crossfadeTriggered = false;
        syntheticEndHandledTrackId = null;
        handoffDoneTrackId = null;
        previewGateFired = false;
        pendingResumeSeek = null; // troca de faixa normal — sem seek de retomada
        lastProgressCommit = 0;
        fallbackTried = new Set();
        fallbackAttempts = 0;
        clearLoadWatchdog();
        clearHandoffTimer();
        set({
          currentTrack: track,
          queueIndex: index,
          isPlaying: autoplay,
          progress: 0,
          buffered: 0,
          duration: track.durationMs / 1000,
        });

        // O GUARDIÃO DO OFFLINE PRECISA SABER O QUE VEM A SEGUIR.
        //
        // Sem isto ele baixaria na ordem da biblioteca, e a faixa que você
        // mandou tocar agora seria a última da fila de download — que é o mesmo
        // que não ter offline nenhum. Ver lib/offline/guardiaoOffline.ts.
        void import('@/lib/offline/guardiaoOffline')
          .then(({ informarContexto }) => {
            const { queue, queueIndex } = get();
            // O assimilador adianta o CONTEÚDO do que vem a seguir; o guardião
            // adianta os BYTES. Mesma fila, dois adiantamentos diferentes.
            informarFila(queue.slice(queueIndex + 1).map((t) => t.id));
            informarContexto({
              // A FILA INTEIRA, não as próximas sete. O corte antigo fazia a
              // música parar na oitava faixa de uma playlist quando o sinal
              // sumia — justamente a situação para a qual o offline existe. O
              // guardião continua baixando uma por vez e parando na cota; só
              // passa a saber para onde a lista vai.
              aSeguir: queue.slice(queueIndex + 1).map((t) => t.id),
              recentes: [track.id],
            });
          })
          .catch(() => undefined);

        // A letra da faixa que está começando fura a fila de transcrição. Sem
        // isto, quem abrisse a letra do que está tocando esperava atrás da
        // playlist inteira que foi baixada meia hora antes.
        void import('@/lib/lyrics/syncFromAudio')
          .then((m) => m.queueLyricsSync(track, { agora: true }))
          .catch(() => undefined);

        // Local audio already resolvable THIS instant → play with zero network.
        const localNow = localLibraryAudioUrl(track.id) ?? localAudioUrl(track.id);
        if (localNow) {
          audioEngine.load(track, { autoplay, crossfadeSeconds });
          applyEngineSettings();
          return;
        }

        // Wait for the local caches to hydrate before touching any network URL —
        // on a fresh boot (especially OFFLINE) the object-URL maps may still be
        // rebuilding, and a downloaded track must NEVER go to the server.
        set({ isBuffering: true });
        void (async () => {
          await localSourcesReady(track.id);
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;

          // `ensureLocalAudioUrl` abre o arquivo AGORA se ele existir. O boot
          // deixou de abrir a biblioteca inteira (custava ~10ms por faixa e
          // travava segundos), então a primeira reprodução de cada faixa paga
          // esse custo — uma vez, só para a que foi pedida. Sem esta linha a
          // faixa baixada iria para a rede, que é o pior erro possível aqui.
          const local = (await ensureLocalAudioUrl(track.id)) ?? localAudioUrl(track.id);
          if (local) {
            audioEngine.load(track, { autoplay, crossfadeSeconds });
            applyEngineSettings();
            return;
          }

          // OFFLINE without a local copy: no network attempts — skip to the
          // next queue track (it may be downloaded) or stop honestly.
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            failCurrentTrack('Sem conexão — essa faixa não está baixada neste dispositivo.');
            return;
          }

          // Existing stream URL or catalog track → load directly.
          if (track.streamUrl || !track.id.startsWith('local:')) {
            audioEngine.load(track, { autoplay, crossfadeSeconds });
            applyEngineSettings();
            armLoadWatchdog(track.id, initialWatchdogMs(track.id));
            sondarFonteEmParalelo(track, index);
            return;
          }

          // Imported track with no audio on THIS device — resolve a stream
          // (uploaded copy or live from the source), then load.
          const resolved = await ensurePlayableSource(track);
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;
          if (resolved !== track && resolved.streamUrl) {
            set((s) => ({
              queue: s.queue.map((t, i) => (i === index ? resolved : t)),
              currentTrack: resolved,
            }));
          }
          audioEngine.load(resolved, { autoplay, crossfadeSeconds });
          applyEngineSettings();
          armLoadWatchdog(track.id, initialWatchdogMs(track.id)); // sempre local: aqui — teto de 60s
        })().catch(() => {
          // Nada aqui pode deixar a faixa "carregando" para sempre.
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;
          failCurrentTrack('Não foi possível carregar esta faixa agora.');
        });
      }

      return {
        currentTrack: null,
        queue: [],
        queueIndex: -1,
        originalQueue: [],
        isPlaying: false,
        progress: 0,
        duration: 0,
        buffered: 0,
        volume: 0.9,
        muted: false,
        repeat: 'off',
        shuffle: false,
        playbackRate: 1,
        isBuffering: false,
        context: null,

        playTrack: (track, context) => {
          const ctx = context ?? { source: 'queue' };
          set({ queue: [track], originalQueue: [track], context: ctx });
          loadIndex(0, true);

          // UMA música sem álbum/playlist → monta uma "rádio" de parecidas em
          // segundo plano e emenda na fila, pra não parar após uma faixa. Fora
          // do fluxo de podcast/rádio (lá "próxima" não é uma música parecida).
          if (ctx.source === 'podcast' || ctx.source === 'radio') return;
          void import('@/lib/reco/radio')
            .then(({ construirRadio }) => {
              const similares = construirRadio(track);
              if (similares.length === 0) return;
              const st = get();
              // Só emenda se o usuário não trocou de faixa/contexto no meio tempo
              // e a fila ainda é só a semente (não pisar numa fila real).
              if (st.currentTrack?.id !== track.id || st.queue.length > 1) return;
              const fila = [track, ...similares];
              set({ queue: fila, originalQueue: fila });
              // Conta ao guardião offline o que vem a seguir, pra já ir baixando.
              void import('@/lib/offline/guardiaoOffline')
                .then(({ informarContexto }) =>
                  informarContexto({
                    aSeguir: similares.map((t) => t.id),
                    recentes: [track.id],
                  }),
                )
                .catch(() => undefined);
            })
            .catch(() => undefined);
        },

        playQueue: (tracks, startIndex = 0, context) => {
          if (tracks.length === 0) return;
          const index = clamp(startIndex, 0, tracks.length - 1);
          const { shuffle } = get();
          const queue = shuffle ? shuffleKeepingFirst(tracks, index) : [...tracks];
          set({
            originalQueue: [...tracks],
            queue,
            context: context ?? { source: 'queue' },
          });
          loadIndex(shuffle ? 0 : index, true);
        },

        playAt: (index) => {
          if (index < 0 || index >= get().queue.length) return;
          loadIndex(index, true);
        },

        next: () => {
          const { queue, queueIndex, repeat } = get();
          const nextIndex = queueIndex + 1;
          if (nextIndex < queue.length) {
            loadIndex(nextIndex, true);
          } else if (repeat === 'all' && queue.length > 0) {
            loadIndex(0, true);
          } else {
            audioEngine.pause();
            set({ isPlaying: false });
          }
        },

        prev: () => {
          const { progress, queueIndex } = get();
          // Restart the track unless we are within its first 3 seconds.
          if (progress > 3 || queueIndex <= 0) {
            audioEngine.seek(0);
            set({ progress: 0 });
            return;
          }
          loadIndex(queueIndex - 1, true);
        },

        toggle: () => {
          const { isPlaying, currentTrack } = get();
          if (!currentTrack) return;
          if (isPlaying) {
            audioEngine.pause();
            set({ isPlaying: false });
            saveResume(true);
          } else {
            get().play();
          }
        },

        play: () => {
          const { currentTrack, queueIndex, progress } = get();
          if (!currentTrack) return;
          // Faixa restaurada de outra sessão (ou engine resetado): o engine
          // ainda não a carregou — carrega agora e retoma NA POSIÇÃO salva.
          if (audioEngine.currentTrack?.id !== currentTrack.id) {
            const resumeAt = progress > 1 ? progress : null;
            loadIndex(Math.max(0, queueIndex), true);
            pendingResumeSeek = resumeAt; // depois do loadIndex (que zera)
            return;
          }
          audioEngine.play();
          set({ isPlaying: true });
          // Voltou a tocar → volta a vigiar travamento (o watchdog se desarma
          // sozinho quando a faixa é pausada).
          armLoadWatchdog(currentTrack.id, STALL_CHECK_MS);
        },

        pause: () => {
          audioEngine.pause();
          set({ isPlaying: false });
          saveResume(true);
        },

        seek: (seconds) => {
          const target = clamp(seconds, 0, get().duration || 0);
          audioEngine.seek(target);
          set({ progress: target });
          // Buscar muda o quanto falta — o temporizador de fim tem que mirar
          // no lugar novo, senão dispara cedo (ou tarde) com a tela apagada.
          rearmEndTimer?.();
        },

        setVolume: (volume) => {
          const value = clamp(volume, 0, 1);
          audioEngine.setVolume(value);
          if (value > 0 && get().muted) {
            audioEngine.setMuted(false);
            set({ volume: value, muted: false });
          } else {
            set({ volume: value });
          }
        },

        toggleMute: () => {
          const muted = !get().muted;
          audioEngine.setMuted(muted);
          set({ muted });
        },

        toggleShuffle: () => {
          const { shuffle, queue, queueIndex, originalQueue, currentTrack } = get();
          if (queue.length === 0) {
            set({ shuffle: !shuffle });
            return;
          }
          if (!shuffle) {
            set({
              shuffle: true,
              originalQueue: [...queue],
              queue: shuffleKeepingFirst(queue, queueIndex),
              queueIndex: 0,
            });
          } else {
            const restored = [...originalQueue];
            // Prefer identity, fall back to id (queue may contain duplicates).
            const byRef = currentTrack ? restored.findIndex((t) => t === currentTrack) : -1;
            const index =
              byRef >= 0
                ? byRef
                : currentTrack
                  ? restored.findIndex((t) => t.id === currentTrack.id)
                  : -1;
            set({
              shuffle: false,
              queue: restored,
              queueIndex: index >= 0 ? index : 0,
            });
          }
          preloadRequested = false; // next track changed
        },

        cycleRepeat: () => {
          const order: RepeatMode[] = ['off', 'all', 'one'];
          const current = order.indexOf(get().repeat);
          const nextMode = order[(current + 1) % order.length] ?? 'off';
          set({ repeat: nextMode });
        },

        addToQueue: (tracks) => {
          const items = toArray(tracks);
          if (items.length === 0) return;
          set((state) => ({
            queue: [...state.queue, ...items],
            originalQueue: [...state.originalQueue, ...items],
          }));
          preloadRequested = false;
        },

        playNext: (tracks) => {
          const items = toArray(tracks);
          if (items.length === 0) return;
          set((state) => {
            const queue = [...state.queue];
            queue.splice(state.queueIndex + 1, 0, ...items);
            const originalQueue = [...state.originalQueue];
            const anchor = state.currentTrack
              ? originalQueue.findIndex((t) => t.id === state.currentTrack?.id)
              : -1;
            originalQueue.splice(anchor >= 0 ? anchor + 1 : originalQueue.length, 0, ...items);
            return { queue, originalQueue };
          });
          preloadRequested = false;
        },

        removeFromQueue: (index) => {
          const { queue, queueIndex } = get();
          const removed = queue[index];
          if (!removed) return;
          const nextQueue = queue.filter((_, i) => i !== index);
          const origIndex = get().originalQueue.indexOf(removed);
          const nextOriginal =
            origIndex >= 0
              ? get().originalQueue.filter((_, i) => i !== origIndex)
              : get().originalQueue;

          if (index === queueIndex) {
            set({ queue: nextQueue, originalQueue: nextOriginal });
            if (nextQueue.length === 0) {
              audioEngine.pause();
              set({
                currentTrack: null,
                queueIndex: -1,
                isPlaying: false,
                progress: 0,
                duration: 0,
              });
            } else {
              loadIndex(Math.min(index, nextQueue.length - 1), get().isPlaying);
            }
          } else {
            set({
              queue: nextQueue,
              originalQueue: nextOriginal,
              queueIndex: index < queueIndex ? queueIndex - 1 : queueIndex,
            });
          }
          preloadRequested = false;
        },

        reorderQueue: (from, to) => {
          const { queue, queueIndex } = get();
          if (from === to || from < 0 || from >= queue.length || to < 0 || to >= queue.length) {
            return;
          }
          const next = [...queue];
          const [moved] = next.splice(from, 1);
          if (!moved) return;
          next.splice(to, 0, moved);

          let index = queueIndex;
          if (from === queueIndex) index = to;
          else if (from < queueIndex && to >= queueIndex) index = queueIndex - 1;
          else if (from > queueIndex && to <= queueIndex) index = queueIndex + 1;

          set({ queue: next, queueIndex: index });
          preloadRequested = false;
        },

        setUpNext: (tracks) => {
          const { queue, queueIndex } = get();
          set({ queue: [...queue.slice(0, queueIndex + 1), ...tracks] });
          preloadRequested = false;
        },

        clearQueue: () => {
          const { currentTrack } = get();
          set({
            queue: currentTrack ? [currentTrack] : [],
            originalQueue: currentTrack ? [currentTrack] : [],
            queueIndex: currentTrack ? 0 : -1,
          });
          audioEngine.preloadNext(null);
          preloadRequested = false;
        },

        setRate: (rate) => {
          const value = clamp(rate, 0.5, 2);
          audioEngine.setRate(value);
          set({ playbackRate: value });
        },
      };
    },
    {
      name: 'aurial:player',
      partialize: (state) => ({ volume: state.volume }),
    },
  ),
);

// ────────────────────────────────────────────────────────────────
// Engine bootstrap — call exactly once from App.
// ────────────────────────────────────────────────────────────────

let engineInitialized = false;

export function initPlayerEngine(): void {
  if (engineInitialized) return;
  engineInitialized = true;

  const store = usePlayerStore;

  // Destrava o áudio no PRIMEIRO gesto (ver AudioEngine.unlock): sem isto, a
  // primeira faixa que depende de rede é bloqueada pela política de autoplay
  // porque o play() acontece depois do await — e "aparece parada" até o 2º
  // clique. Auto-removível; unlock() é idempotente.
  if (typeof document !== 'undefined') {
    const eventos = ['pointerdown', 'keydown', 'touchend'] as const;
    const destravar = (): void => {
      audioEngine.unlock();
      for (const ev of eventos) document.removeEventListener(ev, destravar, true);
    };
    for (const ev of eventos) document.addEventListener(ev, destravar, { capture: true });
  }

  // Prefer local copies: the engine asks this resolver before the network.
  // Consults both the on-device local library and the offline-download cache.
  audioEngine.setLocalSourceResolver(
    (track) => localLibraryAudioUrl(track.id) ?? localAudioUrl(track.id),
  );
  void localAudioReady();

  // Retomar de onde parou: a última faixa volta PAUSADA na posição exata —
  // o primeiro play carrega o áudio e busca a posição (ver play()).
  const resume = readResume();
  if (resume && !store.getState().currentTrack) {
    store.setState({
      currentTrack: resume.track,
      queue: [resume.track],
      originalQueue: [resume.track],
      queueIndex: 0,
      progress: resume.progress,
      duration: resume.track.durationMs / 1000,
      isPlaying: false,
      context: { source: 'queue' },
    });
    // Recarregou por causa de uma versão nova COM a música tocando: volta
    // tocando de onde estava. Apaga a marca primeiro — é de uso único, para uma
    // reabertura comum depois não começar a tocar sozinha. Se o navegador
    // recusar o autoplay (aba nova sem histórico de mídia), a faixa fica pronta
    // e pausada, e o play da tela ou do controle de mídia retoma.
    if (resume.tocando) {
      saveResume(true); // reescreve sem a marca `tocando`
      resumeAt(resume.progress);
      void store.getState().play();
    }
  }
  // Última chance de gravar a posição ao sair/minimizar o app.
  window.addEventListener('pagehide', () => saveResume(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveResume(true);
      // A tela acabou de apagar: rearma a troca antecipada com o "quanto falta"
      // de AGORA. Sem isto, apagar a tela nos últimos segundos deixava a faixa
      // sem a rede de segurança da troca e ela caía no vão de silêncio do fim.
      rearmEndTimer?.();
    }
  });

  // OS lock-screen / notification controls + background-play signalling.
  initMediaSession();

  const advanceFromTrackEnd = (): void => {
    const state = store.getState();
    syntheticEndHandledTrackId = null;
    if (state.repeat === 'one') {
      audioEngine.seek(0);
      audioEngine.play();
      playRecorded = false;
      store.setState({ progress: 0, isPlaying: true });
      return;
    }
    const nextIndex = state.queueIndex + 1;
    if (nextIndex < state.queue.length) {
      state.playAt(nextIndex);
    } else if (state.repeat === 'all' && state.queue.length > 0) {
      state.playAt(0);
    } else {
      store.setState({ isPlaying: false, progress: state.duration });
    }
  };

  // Restore persisted volume / apply audio settings.
  audioEngine.setVolume(store.getState().volume);
  const settings = useSettingsStore.getState();
  audioEngine.setEq(settings.eq);
  audioEngine.setNormalizeVolume(settings.normalizeVolume);

  // Keep engine in sync with settings changes.
  useSettingsStore.subscribe((state, prev) => {
    if (state.eq !== prev.eq) audioEngine.setEq(state.eq);
    if (state.normalizeVolume !== prev.normalizeVolume) {
      audioEngine.setNormalizeVolume(state.normalizeVolume);
    }
  });

  audioEngine.on('timeupdate', ({ position, duration }) => {
    anotarDuracaoMedida(duration);
    const state = store.getState();

    // Som saindo = fila saudável. Zerar aqui (e não só no 'loaded') cobre a
    // faixa PRÉ-CARREGADA promovida, que não redispara 'loaded'.
    if (position > 0) {
      resetDeadRun();
      // Saiu som: se esta faixa estava no mapa de falhas, o caso está
      // encerrado. É a ÚNICA prova aceitável de reparo — "o importador disse
      // que baixou" não é a mesma coisa que "a pessoa ouviu".
      const tocando = usePlayerStore.getState().currentTrack;
      if (tocando) {
        try {
          faixasQueFalharam.marcarReparada(tocando.id);
        } catch {
          /* diagnóstico nunca interrompe a reprodução */
        }
      }
    }

    // Visitantes ouvem 30s por faixa — depois disso, convite para registrar.
    if (!signedIn && position >= PREVIEW_SECONDS) firePreviewGate();

    // Throttle store writes to ~5/s — components needing 60fps read the engine.
    const now = Date.now();
    if (now - lastProgressCommit >= 200) {
      lastProgressCommit = now;
      store.setState({
        progress: position,
        duration: duration || state.duration,
        buffered: audioEngine.getBufferedEnd(),
      });
      saveResume(); // "de onde parou" (1 escrita leve a cada 5s, no máximo)
    }

    // Record the play once at 30s or 50% listened (fire-and-forget).
    if (
      !playRecorded &&
      state.currentTrack &&
      (position >= 30 || (duration > 0 && position / duration >= 0.5))
    ) {
      playRecorded = true;
      const input: RecordPlayInput = {
        trackId: state.currentTrack.id,
        playedMs: Math.round(position * 1000),
        source: state.context?.source ?? 'queue',
        sourceId: state.context?.sourceId,
        completed: false,
      };
      // Record to on-device history unless a private session is active.
      if (!useSettingsStore.getState().privateSession) {
        localHistory.record(state.currentTrack, {
          playedMs: input.playedMs,
          source: input.source,
        });
      }
      void api.post('/me/history', input).catch(() => undefined);
      onPlayRecorded?.(input);
    }

    const { gapless, crossfadeSeconds } = useSettingsStore.getState();
    const remaining = duration - position;

    if (
      state.isPlaying &&
      state.currentTrack &&
      duration > 0 &&
      remaining <= 0.35 &&
      audioEngine.isTrackEnded() &&
      syntheticEndHandledTrackId !== state.currentTrack.id
    ) {
      syntheticEndHandledTrackId = state.currentTrack.id;
      advanceFromTrackEnd();
      return;
    }

    // Gapless: preload the upcoming track near the end.
    //
    // Com a tela apagada preload SEMPRE, mesmo com gapless desligado: a troca em
    // segundo plano (ver `armHandoffTimer`) precisa promover um elemento já
    // pronto — pedir a rede no instante da troca travaria o play() no vão de
    // silêncio, que é justamente o bug que este preload evita.
    const hidden = typeof document !== 'undefined' && document.hidden;
    if ((gapless || hidden) && !preloadRequested && duration > 0 && remaining <= 12) {
      preloadRequested = true;
      const upcoming =
        state.queue[state.queueIndex + 1] ?? (state.repeat === 'all' ? state.queue[0] : undefined);
      audioEngine.preloadNext(upcoming ?? null);
    }

    // Crossfade: start the next track early and blend.
    if (
      crossfadeSeconds > 0 &&
      !crossfadeTriggered &&
      state.repeat !== 'one' &&
      duration > crossfadeSeconds * 2 &&
      remaining <= crossfadeSeconds
    ) {
      const nextIndex =
        state.queueIndex + 1 < state.queue.length
          ? state.queueIndex + 1
          : state.repeat === 'all' && state.queue.length > 0
            ? 0
            : -1;
      if (nextIndex >= 0) {
        crossfadeTriggered = true;
        const track = state.queue[nextIndex];
        if (track) {
          playRecorded = false;
          preloadRequested = false;
          lastProgressCommit = 0;
          audioEngine.load(track, { autoplay: true, crossfadeSeconds });
          store.setState({
            currentTrack: track,
            queueIndex: nextIndex,
            isPlaying: true,
            progress: 0,
            buffered: 0,
            duration: track.durationMs / 1000,
          });
          crossfadeTriggered = false;
        }
      }
    }
  });

  /**
   * (Re)arma o temporizador de fim da faixa. Chamado quando ela carrega e
   * sempre que o playhead se move (seek, retomada), porque o alvo é sempre
   * "quanto falta a partir de AGORA".
   */
  const armEndTimer = (): void => {
    clearEndTimer();
    if (typeof window === 'undefined') return;
    const s = store.getState();
    const track = s.currentTrack;
    if (!track || !s.isPlaying) return;
    // A store troca de faixa antes do áudio: numa troca, o engine ainda está na
    // faixa ANTERIOR por um instante. Mirar o timer com a duração e a posição
    // da faixa velha marca o fim no lugar errado — e o alvo é o id da faixa
    // NOVA, então o disparo cairia no meio dela. Quem rearma com os números
    // certos é o 'loaded', que sempre vem.
    if (audioEngine.currentTrack?.id !== track.id) return;

    const duration = audioEngine.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    const restante = duration - audioEngine.getPosition();
    if (restante <= 0) return;

    endTimerTrackId = track.id;
    endTimer = setTimeout(
      () => {
        endTimer = null;
        const atual = store.getState();
        // A faixa mudou no caminho, ou alguém já pausou: nada a fazer.
        if (atual.currentTrack?.id !== endTimerTrackId || !atual.isPlaying) return;
        // O 'ended' de verdade chegou primeiro e já tratou esta faixa.
        if (syntheticEndHandledTrackId === endTimerTrackId) return;
        // Ainda está tocando de verdade (a duração era estimada para baixo):
        // não corta a música, só remarca.
        if (audioEngine.isPlaying && !audioEngine.isTrackEnded()) {
          armEndTimer();
          return;
        }
        syntheticEndHandledTrackId = endTimerTrackId;
        advanceFromTrackEnd();
      },
      restante * 1000 + END_TIMER_SLACK_MS,
    );
  };

  /**
   * Começa a PRÓXIMA faixa um instante antes de a atual acabar, para o sistema
   * nunca ver silêncio na troca com a tela apagada (ver o bloco de comentário em
   * `handoffTimer`). Só age com `document.hidden`: no primeiro plano o 'ended'
   * nativo já entrega gapless perfeito.
   */
  const doHandoff = (): void => {
    handoffTimer = null;
    const s = store.getState();
    const track = s.currentTrack;
    if (!track || !s.isPlaying) return;
    // Tela acesa: deixa o 'ended' nativo cuidar — começar antes só encurtaria a
    // faixa à toa e estragaria o gapless de álbuns.
    if (typeof document !== 'undefined' && !document.hidden) return;
    if (handoffDoneTrackId === track.id) return;
    if (s.repeat === 'one') return; // repetir-uma: o 'ended' re-busca a posição 0
    // Crossfade configurado já começa a próxima cedo sozinho (bloco no
    // 'timeupdate') — não duplicar a troca.
    if (useSettingsStore.getState().crossfadeSeconds > 0) return;

    const nextIndex =
      s.queueIndex + 1 < s.queue.length
        ? s.queueIndex + 1
        : s.repeat === 'all' && s.queue.length > 0
          ? 0
          : -1;
    if (nextIndex < 0) return; // fim da fila: deixa a atual terminar de verdade
    const next = s.queue[nextIndex];
    if (!next) return;
    // Uma faixa só em repeat-all cairia aqui apontando para si mesma: recarregar
    // cedo cortaria a cauda e re-buscaria a rede à toa. Deixa o 'ended' religar.
    if (next.id === track.id) return;

    // A duração pode ter sido subestimada (stream em chunks revela o tamanho
    // real tarde): se ainda falta bastante, não corta — só remarca.
    const restante = audioEngine.getDuration() - audioEngine.getPosition();
    if (restante > BG_HANDOFF_LEAD_MS / 1000 + 2) {
      armHandoffTimer();
      return;
    }

    handoffDoneTrackId = track.id;
    playRecorded = false;
    preloadRequested = false;
    lastProgressCommit = 0;
    // Blend curto: no Android o grafo Web Audio cruza as duas por BG_HANDOFF_XF;
    // no iOS (sem grafo) o engine faz corte seco — mas emitido enquanto a atual
    // ainda tocava, então o play() da próxima é continuação de sessão ATIVA, que
    // o sistema permite. É essa a diferença para o caminho antigo, que só
    // chamava play() DEPOIS do fim, com a sessão já derrubada.
    audioEngine.load(next, { autoplay: true, crossfadeSeconds: BG_HANDOFF_XF });
    store.setState({
      currentTrack: next,
      queueIndex: nextIndex,
      isPlaying: true,
      progress: 0,
      buffered: 0,
      duration: next.durationMs / 1000,
    });
  };

  /**
   * (Re)arma a troca antecipada, mirada em BG_HANDOFF_LEAD_MS antes do fim.
   * Único e distante, resiste ao estrangulamento de segundo plano; a checagem
   * de `document.hidden` fica no disparo, não aqui, porque a tela pode apagar
   * DEPOIS de armado.
   */
  const armHandoffTimer = (): void => {
    clearHandoffTimer();
    if (typeof window === 'undefined') return;
    const s = store.getState();
    const track = s.currentTrack;
    if (!track || !s.isPlaying) return;
    if (audioEngine.currentTrack?.id !== track.id) return; // engine ainda na anterior
    if (handoffDoneTrackId === track.id) return;
    const duration = audioEngine.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration < 2) return; // faixa curta demais para antecipar: fica no 'ended'
    const restante = duration - audioEngine.getPosition();
    handoffTimer = setTimeout(doHandoff, Math.max(0, restante * 1000 - BG_HANDOFF_LEAD_MS));
  };

  const rearmTimers = (): void => {
    armEndTimer();
    armHandoffTimer();
  };
  rearmEndTimer = rearmTimers;

  audioEngine.on('loaded', ({ duration }) => {
    clearLoadWatchdog();
    // NÃO zerar `consecutiveDeadTracks` aqui. 'loaded' significa "os metadados
    // chegaram", não "está saindo som": uma URL de /stream morta responde o
    // cabeçalho, dispara 'loaded' e só então falha. Zerar neste ponto fazia o
    // contador voltar a zero a CADA faixa da cascata, então o teto de 3 nunca
    // era alcançado e o player pulava a fila inteira, faixa após faixa, até
    // acabar. Quem zera é o 'timeupdate' com posição > 0 — som de verdade.
    if (duration > 0 && Number.isFinite(duration)) store.setState({ duration });
    // Carregou, mas ainda pode travar no meio — segue vigiando o playhead.
    const loadedId = store.getState().currentTrack?.id;
    if (loadedId) armLoadWatchdog(loadedId, STALL_CHECK_MS);
    // Retomada: a faixa restaurada terminou de carregar → busca a posição salva.
    if (pendingResumeSeek !== null) {
      const at = Math.min(pendingResumeSeek, Math.max(0, (duration || Infinity) - 1));
      pendingResumeSeek = null;
      audioEngine.seek(at);
      store.setState({ progress: at });
    }
    rearmTimers();
  });

  audioEngine.on('buffering', ({ buffering }) => {
    store.setState({ isBuffering: buffering });
  });

  audioEngine.on('error', ({ message, track, kind }) => {
    clearLoadWatchdog();
    const current = store.getState().currentTrack;
    // Fonte morta ≠ faixa morta: blob evictado do cofre (LRU), cofre fora do
    // ar ou token expirado na URL gravada — tenta a próxima fonte antes de
    // desistir. Só bloqueio de autoplay ('play') não é problema de fonte.
    if (kind !== 'play' && current && track && current.id === track.id) {
      void attemptSourceFallback(current).then((handled) => {
        if (handled) return;
        failCurrentTrack(message);
      });
      return;
    }
    store.setState({ isPlaying: false, isBuffering: false });
    // Toast lazily to avoid a hard dependency for unit tests.
    void import('sonner').then(({ toast }) => toast.error(message));
  });

  /**
   * Outro app tomou o áudio (ou chegou ligação, ou o fone saiu). A única
   * resposta certa é aceitar: acertar o estado para "pausado" e parar de
   * vigiar. Nada de retomar sozinho.
   *
   * Antes disto o player não ficava sabendo da pausa — `isPlaying` seguia
   * `true`, o watchdog via o playhead congelado e chamava `play()` a cada 10s,
   * roubando o alto-falante de volta do outro app, em loop.
   */
  audioEngine.on('interrupted', () => {
    clearLoadWatchdog();
    clearEndTimer();
    clearHandoffTimer();
    store.setState({ isPlaying: false, isBuffering: false });
    saveResume(true);
  });

  audioEngine.on('ended', () => {
    clearEndTimer();
    clearHandoffTimer();
    advanceFromTrackEnd();
  });

  // Play/pause e seek mudam o "quanto falta": os alvos dos temporizadores têm
  // que acompanhar, senão disparam no meio da música depois de uma pausa longa.
  store.subscribe((state, prev) => {
    if (state.isPlaying !== prev.isPlaying || state.currentTrack?.id !== prev.currentTrack?.id) {
      if (state.isPlaying) rearmTimers();
      else {
        clearEndTimer();
        clearHandoffTimer();
      }
    }
  });
}
