/**
 * Presença e CONTROLE de dispositivos (estilo Spotify Connect).
 *
 * Três coisas vivem aqui, todas sobre `users/{uid}/…` no Firestore (as regras
 * já cobrem: só o dono lê/escreve — nenhuma regra nova é necessária):
 *
 *   1. **Presença** — `devices/{deviceId}`: nome, sinal de vida, o que toca,
 *      volume e posição. É o que alimenta a lista de aparelhos.
 *   2. **Posse** — `state/activeDevice`: QUEM pode tocar. Um só por conta.
 *   3. **Comandos** — `commands/{id}`: pausar, pular, volume… endereçados a um
 *      aparelho, aplicados e apagados por ele.
 *
 * **O limite que a plataforma impõe:** o navegador só toca áudio depois de um
 * gesto do usuário. Então mandar "toque" para um aparelho parado que ninguém
 * tocou NÃO funciona — e nenhum truque contorna isso. O que funciona sempre é
 * (a) comandar um aparelho que JÁ está tocando e (b) "trazer para cá", que é
 * gesto por definição. A UI foi desenhada em cima do que é possível.
 *
 * **Por que a posse não é uma trava dentro do playerStore:** `loadIndex`/
 * `playAt` também são chamados pela máquina interna (fim de faixa, crossfade,
 * pulo de faixa morta). Uma trava ali quebraria o avanço automático. Em vez
 * disso o enforcement é reativo: quem não tem a posse e está tocando, se pausa.
 */
import type { Timestamp } from 'firebase/firestore';
// Firestore por import DINÂMICO: este módulo é alcançado pelo AppShell (banner
// de "tocando em outro aparelho"), e um import estático traria os ~250 kB dele
// para o chunk de entrada — ver lib/sync/firestoreLazy.ts.
import { firestore } from '@/lib/sync/firestoreLazy';
import type { User } from 'firebase/auth';
import type { TrackDto } from '@radinho/shared';
import { db, subscribeAuth } from '@/lib/firebase';
import { resumeAt, usePlayerStore } from '@/stores/playerStore';
import { definirAlvoRemoto } from '@/lib/devices/alvoRemoto';

const DEVICE_ID_KEY = 'aurial:deviceId';
const HEARTBEAT_MS = 25_000;
/**
 * Um device sem sinal há mais que isto é considerado offline.
 *
 * Era 60s, e por isso a aba que passava a reprodução para outro aparelho
 * "sumia": pausada e em segundo plano, o navegador estrangula o heartbeat de
 * 25s, e em um minuto ela cruzava o limite e virava "Offline". Três minutos
 * cobrem o vaivém normal entre abas sem deixar um aparelho de fato fechado
 * fingir presença por muito tempo.
 */
const FRESH_MS = 180_000;
/**
 * Janela para OFERECER retomar o que tocava em outro aparelho. Some depois de um
 * tempo: retomar de onde parou faz sentido em horas, não em dias — reabrir o app
 * uma semana depois e ser jogado no meio de uma música esquecida é pior que nada.
 */
const RETOMADA_JANELA_MS = 12 * 60 * 60 * 1000;
/**
 * Comando mais velho que isto é DESCARTADO. Sem isso, um aparelho que ficou
 * offline aplicaria em rajada, ao voltar, todos os "próxima" que perdeu.
 */
const COMMAND_TTL_MS = 30_000;

/** Id estável por navegador/instalação — identifica ESTE aparelho. */
export function getDeviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'sem-storage';
  }
}

/**
 * Modelos Samsung pelo código ("SM-G950F" → "Galaxy S8"). Só o prefixo de
 * letras+3 dígitos importa; a letra final é região/operadora. Lista curta de
 * propósito: os mais comuns por aqui. Fora dela, o código mesmo — melhor que
 * "K", que é o que o Chrome manda desde a redução do user-agent.
 */
const SAMSUNG: Record<string, string> = {
  G950: 'Galaxy S8',
  G955: 'Galaxy S8+',
  G960: 'Galaxy S9',
  G965: 'Galaxy S9+',
  G970: 'Galaxy S10e',
  G973: 'Galaxy S10',
  G975: 'Galaxy S10+',
  G980: 'Galaxy S20',
  G985: 'Galaxy S20+',
  G780: 'Galaxy S20 FE',
  G781: 'Galaxy S20 FE',
  G990: 'Galaxy S21 FE',
  G991: 'Galaxy S21',
  G996: 'Galaxy S21+',
  S901: 'Galaxy S22',
  S906: 'Galaxy S22+',
  S908: 'Galaxy S22 Ultra',
  S911: 'Galaxy S23',
  S916: 'Galaxy S23+',
  S918: 'Galaxy S23 Ultra',
  S711: 'Galaxy S23 FE',
  S921: 'Galaxy S24',
  S926: 'Galaxy S24+',
  S928: 'Galaxy S24 Ultra',
  N950: 'Galaxy Note8',
  N960: 'Galaxy Note9',
  N970: 'Galaxy Note10',
  N975: 'Galaxy Note10+',
  A105: 'Galaxy A10',
  A107: 'Galaxy A10s',
  A115: 'Galaxy A11',
  A125: 'Galaxy A12',
  A135: 'Galaxy A13',
  A145: 'Galaxy A14',
  A155: 'Galaxy A15',
  A165: 'Galaxy A16',
  A205: 'Galaxy A20',
  A207: 'Galaxy A20s',
  A217: 'Galaxy A21s',
  A225: 'Galaxy A22',
  A235: 'Galaxy A23',
  A245: 'Galaxy A24',
  A256: 'Galaxy A25',
  A305: 'Galaxy A30',
  A307: 'Galaxy A30s',
  A315: 'Galaxy A31',
  A325: 'Galaxy A32',
  A336: 'Galaxy A33',
  A346: 'Galaxy A34',
  A356: 'Galaxy A35',
  A505: 'Galaxy A50',
  A507: 'Galaxy A50s',
  A515: 'Galaxy A51',
  A525: 'Galaxy A52',
  A528: 'Galaxy A52s',
  A536: 'Galaxy A53',
  A546: 'Galaxy A54',
  A556: 'Galaxy A55',
  A715: 'Galaxy A71',
  A725: 'Galaxy A72',
  A032: 'Galaxy A03',
  A037: 'Galaxy A03s',
  A045: 'Galaxy A04',
  A047: 'Galaxy A04s',
  A055: 'Galaxy A05',
  A057: 'Galaxy A05s',
  M135: 'Galaxy M13',
  M236: 'Galaxy M23',
  M336: 'Galaxy M33',
  M526: 'Galaxy M52',
  M536: 'Galaxy M53',
  M546: 'Galaxy M54',
};

/** Nome amigável a partir do modelo cru do Android. */
export function nomeDoModelo(cru: string): string {
  const modelo = cru.replace(/\s*build.*$/i, '').trim();
  const sm = /^SM-([A-Z]\d{3})/i.exec(modelo);
  if (sm) return SAMSUNG[sm[1]!.toUpperCase()] ?? modelo;
  return modelo;
}

const MODELO_KEY = 'aurial:deviceModel';
const NOME_KEY = 'aurial:deviceName';

/**
 * O Chrome no Android REDUZ o user-agent: em vez do modelo, manda "K". Era
 * daí que vinham os aparelhos com nome errado. O modelo de verdade só sai pelas
 * Client Hints de alta entropia — pedidas uma vez e guardadas.
 */
export async function descobrirModelo(): Promise<void> {
  const uad = (
    navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ model?: string }> };
    }
  ).userAgentData;
  if (!uad?.getHighEntropyValues) return;
  try {
    const { model } = await uad.getHighEntropyValues(['model']);
    if (model && model.trim()) window.localStorage.setItem(MODELO_KEY, model.trim());
  } catch {
    /* sem hints: fica o que o user-agent disser */
  }
}

/** Qual navegador (ou o app) — é o que separa duas entradas do MESMO aparelho. */
export function nomeDoNavegador(ua = navigator.userAgent): string {
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.Capacitor?.isNativePlatform?.()) return 'App';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Navegador';
}

/** O nome que a própria pessoa deu a este aparelho (vale acima de tudo). */
export function nomePersonalizado(): string | null {
  try {
    return window.localStorage.getItem(NOME_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function renomearEsteAparelho(nome: string): void {
  try {
    const limpo = nome.trim().slice(0, 40);
    if (limpo) window.localStorage.setItem(NOME_KEY, limpo);
    else window.localStorage.removeItem(NOME_KEY);
  } catch {
    /* sem storage */
  }
  publish(true);
}

/**
 * Nome do APARELHO — "Galaxy S8", "iPhone", "Windows" — com o navegador ao
 * lado: o mesmo computador no Chrome e no Edge são duas entradas, e sem o
 * navegador no nome pareciam aparelhos fantasmas.
 */
export function deviceLabel(): string {
  return nomePersonalizado() ?? `${nomeDoAparelhoFisico()} · ${nomeDoNavegador()}`;
}

function nomeDoAparelhoFisico(): string {
  const ua = navigator.userAgent;
  let guardado: string | null = null;
  try {
    guardado = window.localStorage.getItem(MODELO_KEY);
  } catch {
    /* sem storage */
  }
  if (guardado && !/^k$/i.test(guardado)) return nomeDoModelo(guardado);
  // Android antigo (sem redução) ainda traz o modelo entre a versão e o "Build".
  const android = /Android[\d.\s]*;\s*([^;)]+?)(?:\s+Build|\))/i.exec(ua);
  if (android?.[1]) {
    const modelo = nomeDoModelo(android[1]);
    // "K" (user-agent reduzido) e "wv" (WebView) não são modelos.
    if (modelo && !/^(wv|k)$/i.test(modelo)) return modelo;
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'iPad';
  }
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Dispositivo';
}

/**
 * IMPRESSÃO DO APARELHO FÍSICO — igual em todos os navegadores dele.
 *
 * Cada navegador tem seu armazenamento, então ganha seu próprio id; não há como
 * um saber do outro. O que dá para comparar é o que o HARDWARE diz a qualquer
 * navegador: modelo/sistema, tela, fuso, núcleos. É com isto que as entradas
 * velhas do mesmo aparelho (id de um navegador limpo, de outro navegador) são
 * reconhecidas e recolhidas na lista.
 */
export function impressaoDoAparelho(): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const partes = [
    nomeDoAparelhoFisico(),
    `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`,
    String(Math.round((window.devicePixelRatio || 1) * 100)),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(nav.hardwareConcurrency ?? 0),
  ];
  let h = 0x811c9dc5;
  for (const c of partes.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

export interface DevicePresence {
  name: string;
  /** Impressão do aparelho físico (ver `impressaoDoAparelho`). */
  aparelho?: string;
  /** Relógio LOCAL de quem publicou quando `progress` foi medido (ms). */
  progressAt?: number;
  /** ISO do relógio do PRÓPRIO aparelho — usado só como reserva. */
  lastSeenAt: string;
  /** Carimbo do SERVIDOR: normaliza relógios tortos entre aparelhos. */
  seenAt?: Timestamp | null;
  isPlaying: boolean;
  track: { title: string; artist: string; coverUrl: string | null } | null;
  /** Para o controle remoto refletir o estado real do aparelho. */
  trackId?: string | null;
  volume?: number;
  progress?: number;
  duration?: number;
}

/** Um aparelho da conta, como a UI enxerga. */
export interface DeviceInfo {
  id: string;
  name: string;
  isSelf: boolean;
  isPlaying: boolean;
  /** Detém a posse da reprodução (só um por conta). */
  isActive: boolean;
  online: boolean;
  track: { title: string; artist: string; coverUrl: string | null } | null;
  /** Id da faixa — é por ele que "trazer para cá" acha o que carregar. */
  trackId: string | null;
  volume: number;
  progress: number;
  duration: number;
  /** Quando este estado foi publicado (ms). A posição envelhece a partir daqui. */
  seenAt: number;
  /** Impressão do aparelho físico (entradas de navegadores do mesmo aparelho). */
  aparelho: string | null;
}

/** Outro aparelho da MESMA conta tocando agora (para o banner). */
export interface RemotePlayback {
  deviceId: string;
  deviceName: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  isPlaying: boolean;
}

/** Comandos que um aparelho pode mandar para outro. */
export type DeviceCommandType =
  | 'play'
  | 'pause'
  | 'next'
  | 'prev'
  | 'seek'
  | 'volume'
  | 'stop'
  /** "Toque ESTA música aí" — trocar de faixa sem trazer o som para cá. */
  | 'playTrack';

/** O que vai junto do `playTrack`: a faixa e, se houver, a fila em volta dela. */
export interface CargaDeComando {
  trackId?: string;
  /** Ids da fila, na ordem; o outro aparelho monta com o que ele tiver. */
  queue?: string[];
  /** Posição da faixa dentro de `queue`. */
  index?: number;
}

/** Fila grande vira documento grande — o que passa disso não ajuda ninguém. */
const MAX_FILA_NO_COMANDO = 200;

interface DeviceCommand extends CargaDeComando {
  to: string;
  from: string;
  type: DeviceCommandType;
  value?: number;
  at: string;
}

let currentUser: User | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let unsubPlayer: (() => void) | null = null;
let unsubRemote: (() => void) | null = null;
let unsubCommands: (() => void) | null = null;
let unsubActive: (() => void) | null = null;
let lastWriteAt = 0;
let lastSignature = '';
/** Última posição publicada e quando (relógio local): detecta pulos e travadas. */
let publicado = { progresso: 0, em: 0, tocando: false };
/**
 * DIFERENÇA ENTRE O RELÓGIO DESTE APARELHO E O DO SERVIDOR (ms).
 *
 * A posição do outro aparelho é extrapolada a partir do carimbo do servidor;
 * comparar isso com `Date.now()` daqui somava o erro dos DOIS relógios — celular
 * com relógio alguns segundos torto já deixava tempo e letra fora de sincronia.
 * Medido pelas próprias escritas: carimbo do servidor − hora local da medida.
 * O MENOR valor visto é o que tem menos atraso de rede embutido.
 */
let desvioDoRelogio: number | null = null;
/** Poda das entradas mortas: uma vez por sessão. */
let podado = false;
const PODA_MS = 30 * 24 * 60 * 60 * 1000;

/** Agora, no relógio do servidor. */
function agoraNoServidor(): number {
  return Date.now() + (desvioDoRelogio ?? 0);
}
let initialized = false;

/**
 * A ÚLTIMA tentativa de publicar a presença deste aparelho, e como ela terminou.
 *
 * Existe porque "o celular não aparece tocando" tinha QUATRO causas que produzem
 * exatamente o mesmo silêncio — regra do Firestore negando a escrita, ninguém
 * logado, `db` ausente, ou o sinal envelhecido além dos 180s — e nenhuma delas
 * deixava rastro. `radinhoAparelhos()` lê isto para separá-las.
 */
let ultimaEscrita: { em: number; erro: string | null } | null = null;
/** O último erro que a assinatura da coleção de aparelhos devolveu. */
let ultimaLeituraErro: string | null = null;

/** Id do aparelho que detém a posse (null = ninguém reivindicou). */
let activeDeviceId: string | null = null;
let wasPlaying = false;
/**
 * Quando ESTE aparelho reivindicou a posse. A escrita no Firestore e o eco de
 * volta levam centenas de milissegundos, e nesse intervalo ainda chegam
 * snapshots com o dono ANTIGO. Sem esta carência, o próprio play do usuário se
 * pausava sozinho.
 */
let lastClaimAt = 0;
const CLAIM_GRACE_MS = 10_000;
/**
 * Uma posse com carimbo mais novo que isto é um HANDOFF REAL — outro aparelho
 * acabou de assumir, e este pausa. Mais velha é posse do passado (tocou ontem)
 * e é ignorada, para não matar um play novo. A janela cobre a propagação entre
 * aparelhos com folga sem alcançar uma sessão anterior.
 */
const POSSE_FRESCA_MS = 60_000;

const remoteListeners = new Set<(remote: RemotePlayback | null) => void>();
let remoteState: RemotePlayback | null = null;
const deviceListeners = new Set<(devices: DeviceInfo[]) => void>();
let deviceState: DeviceInfo[] = [];

function emitRemote(next: RemotePlayback | null): void {
  const changed =
    (remoteState === null) !== (next === null) ||
    remoteState?.deviceId !== next?.deviceId ||
    remoteState?.title !== next?.title ||
    remoteState?.isPlaying !== next?.isPlaying;
  remoteState = next;
  if (changed) for (const listener of remoteListeners) listener(remoteState);
}

function emitDevices(next: DeviceInfo[]): void {
  deviceState = next;
  // O player lê daqui, sem importar este módulo, para saber se um clique numa
  // música deve tocar aqui ou ser mandado para o aparelho que está com o som.
  const me = getDeviceId();
  const tocandoFora = next.find((d) => d.id !== me && d.online && d.isPlaying && d.track);
  definirAlvoRemoto(tocandoFora ? { id: tocandoFora.id, name: tocandoFora.name } : null);
  for (const listener of deviceListeners) listener(deviceState);
}

/** Assina o estado "tocando em outro aparelho" (null quando não há). */
export function subscribeRemotePlayback(
  listener: (remote: RemotePlayback | null) => void,
): () => void {
  remoteListeners.add(listener);
  listener(remoteState);
  return () => {
    remoteListeners.delete(listener);
  };
}

export function currentRemotePlayback(): RemotePlayback | null {
  return remoteState;
}

/** O que dá para continuar de onde parou, vindo de outro aparelho da conta. */
export interface RetomadaRemota {
  deviceId: string;
  deviceName: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  progress: number;
  duration: number;
}

/**
 * A melhor retomada entre aparelhos, ou `null`.
 *
 * O que o dono pediu: a música que ele ouvia num aparelho deve continuar no
 * outro quando ele logar. A presença já publica faixa e posição de cada
 * aparelho; aqui a gente escolhe a mais recente de OUTRO aparelho, dentro de uma
 * janela de horas, com uma posição que vale a pena retomar.
 *
 * Não exige que o outro esteja tocando AGORA — o caso comum é o contrário: você
 * pausou no celular e abriu no computador. Exige só que tenha uma faixa e uma
 * posição que não seja nem o começo nem o fim (retomar aos 2s ou nos créditos
 * não é retomar nada).
 */
export function retomadaEntreAparelhos(): RetomadaRemota | null {
  const me = getDeviceId();
  const now = Date.now();
  let melhor: DeviceInfo | null = null;
  for (const d of deviceState) {
    if (d.isSelf || d.id === me) continue;
    if (!d.trackId || !d.track) continue;
    if (now - d.seenAt > RETOMADA_JANELA_MS) continue;
    const restante = d.duration > 0 ? d.duration - d.progress : Infinity;
    if (d.progress < 5 || restante < 15) continue; // nem no início, nem nos finais
    if (!melhor || d.seenAt > melhor.seenAt) melhor = d;
  }
  if (!melhor || !melhor.track) return null;
  return {
    deviceId: melhor.id,
    deviceName: melhor.name,
    title: melhor.track.title,
    artist: melhor.track.artist,
    coverUrl: melhor.track.coverUrl,
    progress: melhor.progress,
    duration: melhor.duration,
  };
}

/** Assina a LISTA de aparelhos da conta (para o seletor). */
export function subscribeDevices(listener: (devices: DeviceInfo[]) => void): () => void {
  deviceListeners.add(listener);
  listener(deviceState);
  return () => {
    deviceListeners.delete(listener);
  };
}

export function currentDevices(): DeviceInfo[] {
  return deviceState;
}

/** True quando ESTE aparelho pode tocar (ninguém reivindicou, ou fui eu). */
export function isActiveDevice(): boolean {
  return activeDeviceId === null || activeDeviceId === getDeviceId();
}

/**
 * O aparelho para onde os controles devem apontar, ou `null` quando é aqui
 * mesmo.
 *
 * ISSO EXISTE PORQUE o volume da barra do player mexia SEMPRE no alto-falante
 * local. Com a música tocando na sala e o controle na mão, abaixar o volume não
 * abaixava nada que se pudesse ouvir — mexia num áudio mudo neste aparelho.
 * Controle remoto que não controla o remoto não é controle.
 *
 * A condição é estrita de propósito: só desvia quando o outro aparelho está
 * online, tocando, E este aqui não está. Se os dois tocam, cada um cuida do
 * próprio volume — desviar aí faria o usuário abaixar o alto-falante errado.
 */
export function remoteControlTarget(): DeviceInfo | null {
  if (usePlayerStore.getState().isPlaying) return null;
  const me = getDeviceId();
  return deviceState.find((d) => d.id !== me && d.online && d.isPlaying) ?? null;
}

/**
 * O aparelho remoto a ESPELHAR na barra do player: outro aparelho da conta,
 * online e tocando, quando não há faixa carregada AQUI. É o que faz a música do
 * outro aparelho aparecer na barra como se fosse daqui, com o nome dele ao lado.
 */
export function dispositivoRemotoAtivo(): DeviceInfo | null {
  const me = getDeviceId();
  return deviceState.find((d) => d.id !== me && d.online && d.isPlaying && d.track) ?? null;
}

/**
 * A POSIÇÃO DA MÚSICA QUE ESTA TELA MOSTRA, em segundos: a do outro aparelho
 * quando é ele que está tocando (e daqui nada toca), senão a daqui. É o relógio
 * que a letra e a animação do play seguem — o mesmo em todos os aparelhos.
 */
export function posicaoDoQueToca(posicaoLocal: () => number): number | null {
  const local = usePlayerStore.getState();
  if (local.isPlaying || (local.currentTrack && !dispositivoRemotoAtivo())) return posicaoLocal();
  const remoto = dispositivoRemotoAtivo();
  return remoto ? posicaoAtualDe(remoto) : null;
}

/** A posição estimada AGORA de um aparelho remoto (extrapola o relógio). */
export function posicaoEstimada(device: DeviceInfo): number {
  return posicaoAtualDe(device);
}

/** Quando foi visto pela última vez, preferindo o relógio do servidor. */
function seenMillis(p: DevicePresence): number {
  const server = p.seenAt;
  if (server && typeof server.toMillis === 'function') return server.toMillis();
  const parsed = new Date(p.lastSeenAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Publica o estado DESTE aparelho (throttled — no máx. 1 escrita / 2s). */
function publish(force = false): void {
  if (!db || !currentUser) return;
  const state = usePlayerStore.getState();
  const track = state.currentTrack;
  const signature = `${track?.id ?? ''}|${state.isPlaying}|${Math.round(state.volume * 20)}`;
  const now = Date.now();
  if (!force && signature === lastSignature && now - lastWriteAt < HEARTBEAT_MS) return;
  if (!force && now - lastWriteAt < 2_000) return;
  lastSignature = signature;
  lastWriteAt = now;
  publicado = { progresso: state.progress, em: now, tocando: state.isPlaying };
  const uid = currentUser.uid;
  void (async () => {
    const { doc, serverTimestamp, setDoc } = await firestore();
    if (!db) return;
    const payload: DevicePresence = {
      name: deviceLabel(),
      aparelho: impressaoDoAparelho(),
      progressAt: now,
      lastSeenAt: new Date().toISOString(),
      seenAt: serverTimestamp() as unknown as Timestamp,
      isPlaying: state.isPlaying,
      track: track
        ? { title: track.title, artist: track.artists[0]?.name ?? '', coverUrl: track.coverUrl }
        : null,
      trackId: track?.id ?? null,
      volume: state.volume,
      progress: state.progress,
      duration: state.duration,
    };
    await setDoc(doc(db, 'users', uid, 'devices', getDeviceId()), payload);
    ultimaEscrita = { em: Date.now(), erro: null };
  })().catch((err: unknown) => {
    // NÃO ENGOLIR MAIS. Este `.catch(() => undefined)` era o motivo de "o
    // celular não aparece" não ter resposta: regra do Firestore negando a
    // escrita produzia exatamente o mesmo silêncio que estar deslogado, que
    // estar sem `db`, e que o sinal ter envelhecido. Quatro causas, um sintoma,
    // zero evidência. Continua não derrubando nada — só deixa de ser invisível.
    ultimaEscrita = { em: Date.now(), erro: err instanceof Error ? err.message : String(err) };
  });
}

// ── posse da reprodução ─────────────────────────────────────────

/**
 * Reivindica a posse para ESTE aparelho: os outros se pausam sozinhos ao ver
 * a mudança. Chamado quando o usuário dá play aqui ou pede "trazer para cá" —
 * sempre atrás de um gesto, que é o que o navegador exige para tocar.
 */
export function claimPlayback(): void {
  lastClaimAt = Date.now(); // abre a carência ANTES de qualquer await
  // QUEM ASSUME O SOM DEIXA DE TER PARA ONDE MANDAR. Sem esta linha, "ouvir
  // aqui" se sabotava: o outro aparelho recebe o `pause`, mas a presença dele
  // só chega uns dois segundos depois — e no meio-tempo o `playTrack` da
  // transferência era desviado de volta para lá, exatamente o que ela desfaz.
  definirAlvoRemoto(null);
  if (!db || !currentUser) return;
  activeDeviceId = getDeviceId(); // otimista: a UI reage na hora
  const uid = currentUser.uid;
  void (async () => {
    const { doc, serverTimestamp, setDoc } = await firestore();
    if (!db) return;
    await setDoc(doc(db, 'users', uid, 'state', 'activeDevice'), {
      deviceId: getDeviceId(),
      name: deviceLabel(),
      at: serverTimestamp(),
    });
  })().catch(() => undefined);
}

/** Manda um comando para OUTRO aparelho. */
export async function sendCommand(
  toDeviceId: string,
  type: DeviceCommandType,
  value?: number,
  carga?: CargaDeComando,
): Promise<void> {
  if (!db || !currentUser) return;
  const payload: DeviceCommand = {
    to: toDeviceId,
    from: getDeviceId(),
    type,
    at: new Date().toISOString(),
    ...(value !== undefined ? { value } : {}),
    ...(carga?.trackId ? { trackId: carga.trackId } : {}),
    ...(carga?.queue && carga.queue.length > 0
      ? { queue: carga.queue.slice(0, MAX_FILA_NO_COMANDO), index: carga.index ?? 0 }
      : {}),
  };
  const { addDoc, collection } = await firestore();
  await addDoc(collection(db, 'users', currentUser.uid, 'commands'), payload).catch(
    () => undefined,
  );
}

/**
 * Onde a faixa do outro aparelho está AGORA.
 *
 * A posição publicada é uma foto: o aparelho remoto escreve no máximo a cada
 * 2s, e em faixa parada só a cada 25s do heartbeat. Usar esse número cru fazia
 * "trazer para cá" voltar até meio minuto no tempo — a música recomeçava num
 * trecho que o usuário já tinha ouvido. Se ele estava TOCANDO, o relógio andou
 * junto: some o tempo desde a publicação.
 */
function posicaoAtualDe(device: DeviceInfo): number {
  if (!device.isPlaying) return device.progress;
  const decorrido = Math.max(0, (agoraNoServidor() - device.seenAt) / 1000);
  const estimada = device.progress + decorrido;
  // Nunca passar do fim: com sinal velho a conta pode estourar a duração, e
  // buscar além do fim faz a faixa acabar na hora em que ela chega.
  const teto = device.duration > 0 ? Math.max(0, device.duration - 1) : Infinity;
  return Math.min(estimada, teto);
}

/**
 * Traz a reprodução para ESTE aparelho: pausa o outro, assume a posse e
 * continua a MESMA faixa de onde ela estava. Precisa ter vindo de um clique —
 * é o gesto que autoriza o navegador a tocar.
 *
 * ANTES isto só funcionava quando a faixa por acaso já estava carregada aqui.
 * Abrir o app no computador com o celular tocando e pedir "ouvir aqui" chamava
 * `play()` num player vazio: nada acontecia, sem erro nenhum. Agora a faixa é
 * procurada pelo id (a biblioteca inteira sincroniza via Firestore) e carregada
 * na posição certa.
 */
export async function transferPlaybackHere(fromDeviceId?: string): Promise<void> {
  const source = fromDeviceId ?? remoteState?.deviceId;
  const device = deviceState.find((d) => d.id === source);
  if (source) await sendCommand(source, 'pause');
  claimPlayback();

  const player = usePlayerStore.getState();
  const posicao = device ? posicaoAtualDe(device) : 0;

  // Mesma faixa já carregada aqui: só reposiciona e segue.
  if (device?.trackId && player.currentTrack?.id === device.trackId) {
    if (posicao > 0) player.seek(posicao);
    player.play();
    return;
  }

  // Faixa diferente (ou nenhuma): procura pelo id na fila atual e depois na
  // biblioteca deste aparelho, carrega e já nasce na posição do outro.
  const alvo = device?.trackId ? await acharFaixa(device.trackId) : null;
  if (alvo) {
    player.playTrack(alvo);
    resumeAt(posicao);
    return;
  }

  player.play();
}

/**
 * Procura uma faixa pelo id: primeiro na fila carregada, depois na biblioteca
 * local (que espelha o Firestore, então a faixa do outro aparelho está aqui
 * mesmo que o áudio não esteja — o player resolve a fonte sozinho).
 */
export async function acharFaixa(trackId: string): Promise<TrackDto | null> {
  const naFila = usePlayerStore.getState().queue.find((t) => t.id === trackId);
  if (naFila) return naFila;
  try {
    const { list, hydrate } = await import('@/lib/local/localLibrary');
    await hydrate().catch(() => undefined);
    return list().find((e) => e.track.id === trackId)?.track ?? null;
  } catch {
    return null;
  }
}

/**
 * "TOQUE ESTA AÍ" — o clique aconteceu no computador, o som sai aqui.
 *
 * Monta a fila com o que este aparelho tem das faixas pedidas (a biblioteca é a
 * mesma, mas pode estar a meio caminho de sincronizar) e começa na faixa que
 * foi clicada. Sem nenhuma delas, não faz nada: melhor a música seguir como
 * está do que parar por um comando que não deu para cumprir.
 */
async function tocarFaixaPedida(command: DeviceCommand): Promise<void> {
  const principal = command.trackId ? await acharFaixa(command.trackId) : null;
  if (!principal) return;
  claimPlayback();
  const player = usePlayerStore.getState();

  const ids = command.queue ?? [];
  if (ids.length > 1) {
    const fila = (await Promise.all(ids.map((id) => acharFaixa(id)))).filter(
      (t): t is TrackDto => t !== null,
    );
    const inicio = fila.findIndex((t) => t.id === principal.id);
    if (inicio >= 0 && fila.length > 1) {
      player.playQueue(fila, inicio);
      publish(true);
      return;
    }
  }
  player.playTrack(principal);
  publish(true);
}

/** Aplica um comando recebido no player LOCAL. */
function applyCommand(command: DeviceCommand): void {
  const player = usePlayerStore.getState();
  switch (command.type) {
    case 'pause':
      player.pause();
      break;
    case 'play':
      // Pode ser recusado pela política de autoplay se ninguém tocou neste
      // aparelho — o AudioEngine já trata e avisa; nada a fazer aqui.
      claimPlayback();
      player.play();
      break;
    case 'next':
      player.next();
      break;
    case 'prev':
      player.prev();
      break;
    case 'seek':
      if (typeof command.value === 'number') player.seek(command.value);
      break;
    case 'volume':
      if (typeof command.value === 'number') player.setVolume(command.value);
      break;
    case 'stop':
      player.pause();
      break;
    case 'playTrack':
      // ASSÍNCRONO de propósito: a faixa pode não estar na fila daqui e ter que
      // vir da biblioteca. O `publish` no fim deste corpo sai antes disso e
      // ainda conta a faixa ANTIGA; o próximo pulso (ou o próprio play) conta a
      // nova. Um segundo de atraso na pílula é melhor que segurar o comando.
      void tocarFaixaPedida(command);
      return;
  }
  publish(true); // devolve o novo estado para quem mandou, sem esperar o heartbeat
}

function start(user: User): void {
  currentUser = user;
  publish(true);
  heartbeat = setInterval(() => publish(), HEARTBEAT_MS);

  // Mudou faixa/play/volume → publica na hora (respeitando o throttle).
  unsubPlayer = usePlayerStore.subscribe((state) => {
    // Começou a tocar AQUI → esta passa a ser a aparelha da vez.
    if (state.isPlaying && !wasPlaying) claimPlayback();
    wasPlaying = state.isPlaying;
    // PULO OU TRAVADA: a posição saiu do que os outros estão extrapolando.
    // Sem republicar na hora, o outro aparelho seguia com o tempo errado (e a
    // letra com ele) até o próximo sinal de vida, 25 s depois.
    const esperado = publicado.tocando
      ? publicado.progresso + (Date.now() - publicado.em) / 1000
      : publicado.progresso;
    if (Math.abs(state.progress - esperado) > 1.5) publish(true);
    else publish();
  });

  // Os três ouvintes abaixo dependem do Firestore, que chega por import
  // dinâmico. `stop()` continua correto no meio do caminho: ele zera
  // `currentUser`, e a guarda logo abaixo desiste de assinar.
  void (async () => {
    const { collection, deleteDoc, doc, onSnapshot } = await firestore();
    if (!db || currentUser?.uid !== user.uid) return;

    // ── posse ────────────────────────────────────────────────────
    unsubActive = onSnapshot(
      doc(db, 'users', user.uid, 'state', 'activeDevice'),
      (snap) => {
        const data = snap.data() as
          { deviceId?: string; name?: string; at?: Timestamp } | undefined;
        activeDeviceId = data?.deviceId ?? null;

        // UM APARELHO SÓ TOCA POR VEZ — mas silenciar o usuário à toa é o pior
        // erro possível. O equilíbrio está na IDADE da posse, não na presença.
        //
        // Antes a pausa dependia de ver, na presença, o outro aparelho "tocando
        // agora". Só que a posse (`state/activeDevice`) e a presença
        // (`devices/{id}`) são dois documentos que chegam em tempos diferentes:
        // a posse do aparelho 2 chegava ao aparelho 1 ANTES do "tocando", então
        // o aparelho 1 não via conflito e os DOIS tocavam músicas diferentes.
        //
        // Agora confiamos na posse em si, desde que FRESCA: se outro aparelho
        // acabou de assumir (carimbo dos últimos segundos), paramos aqui na hora
        // — a barra deste aparelho passa a espelhar o que o outro toca. A posse
        // VELHA (ter tocado no celular ontem) tem carimbo antigo e é ignorada,
        // que é o que evita o play novo morrer sozinho.
        if (activeDeviceId && activeDeviceId !== getDeviceId()) {
          const player = usePlayerStore.getState();
          const reivindicacaoRecente = Date.now() - lastClaimAt < CLAIM_GRACE_MS;
          const posseMs =
            data?.at && typeof data.at.toMillis === 'function' ? data.at.toMillis() : 0;
          const posseFresca = posseMs > 0 && Date.now() - posseMs < POSSE_FRESCA_MS;
          if (player.isPlaying && posseFresca && !reivindicacaoRecente) {
            player.pause();
            void import('sonner').then(({ toast }) =>
              toast(`Reprodução movida para ${data?.name ?? 'outro aparelho'}`),
            );
          }
        }
        emitDevices(deviceState); // reavalia quem está marcado como ativo
      },
      () => undefined,
    );

    // ── lista de aparelhos + banner ──────────────────────────────
    unsubRemote = onSnapshot(
      collection(db, 'users', user.uid, 'devices'),
      (snap) => {
        const me = getDeviceId();
        const devices: DeviceInfo[] = [];
        let found: RemotePlayback | null = null;
        for (const d of snap.docs) {
          const p = d.data() as DevicePresence;
          const seenAt = seenMillis(p);
          if (d.id === me && typeof p.progressAt === 'number' && p.seenAt) {
            const amostra = seenAt - p.progressAt;
            if (Math.abs(amostra) < 6 * 60 * 60 * 1000) {
              desvioDoRelogio =
                desvioDoRelogio === null ? amostra : Math.min(desvioDoRelogio, amostra);
            }
          }
          const online = agoraNoServidor() - seenAt < FRESH_MS;
          // Entrada morta há mais de um mês (navegador limpo, aparelho trocado):
          // sai da conta, uma vez por sessão.
          if (!podado && d.id !== me && agoraNoServidor() - seenAt > PODA_MS) {
            void deleteDoc(d.ref).catch(() => undefined);
            continue;
          }
          devices.push({
            aparelho: p.aparelho ?? null,
            id: d.id,
            name: p.name,
            isSelf: d.id === me,
            isPlaying: Boolean(p.isPlaying),
            isActive: activeDeviceId === d.id,
            online,
            track: p.track ?? null,
            trackId: p.trackId ?? null,
            volume: typeof p.volume === 'number' ? p.volume : 1,
            progress: typeof p.progress === 'number' ? p.progress : 0,
            duration: typeof p.duration === 'number' ? p.duration : 0,
            seenAt,
          });
          if (d.id !== me && online && p.isPlaying && p.track) {
            found ??= {
              deviceId: d.id,
              deviceName: p.name,
              title: p.track.title,
              artist: p.track.artist,
              coverUrl: p.track.coverUrl,
              isPlaying: true,
            };
          }
        }
        podado = true;
        // O MESMO APARELHO NÃO APARECE DUAS VEZES OFFLINE. Id novo a cada
        // navegador limpo/reinstalado deixava fantasmas: "Galaxy S8", "Galaxy
        // S8", "Galaxy S8". Entrada offline some quando há outra do mesmo
        // aparelho (mesma impressão, ou mesmo nome nas entradas antigas sem
        // impressão) mais recente ou online.
        const chave = (d: DeviceInfo) => d.aparelho ?? `nome:${d.name}`;
        const melhorPorChave = new Map<string, DeviceInfo>();
        for (const d of devices) {
          const atual = melhorPorChave.get(chave(d));
          const melhor =
            !atual ||
            Number(d.isSelf) - Number(atual.isSelf) > 0 ||
            (d.isSelf === atual.isSelf &&
              (Number(d.online) - Number(atual.online) > 0 ||
                (d.online === atual.online && d.seenAt > atual.seenAt)));
          if (melhor) melhorPorChave.set(chave(d), d);
        }
        for (let i = devices.length - 1; i >= 0; i--) {
          const d = devices[i]!;
          if (!d.online && !d.isSelf && melhorPorChave.get(chave(d)) !== d) devices.splice(i, 1);
        }
        // Online primeiro, depois quem está tocando, depois nome.
        devices.sort(
          (a, b) =>
            Number(b.online) - Number(a.online) ||
            Number(b.isPlaying) - Number(a.isPlaying) ||
            a.name.localeCompare(b.name),
        );
        emitDevices(devices);
        emitRemote(found);
      },
      (err: unknown) => {
        // Mesma razão do catch da escrita: uma leitura negada apagava a lista de
        // aparelhos e ficava indistinguível de "não há nenhum outro aparelho".
        ultimaLeituraErro = err instanceof Error ? err.message : String(err);
        emitRemote(null);
        emitDevices([]);
      },
    );

    // ── comandos endereçados a MIM ───────────────────────────────
    unsubCommands = onSnapshot(
      collection(db, 'users', user.uid, 'commands'),
      (snap) => {
        const me = getDeviceId();
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          const command = change.doc.data() as DeviceCommand;
          if (command.to !== me) continue;
          // Comando velho = eco de quando este aparelho estava offline.
          const age = Date.now() - new Date(command.at).getTime();
          if (!Number.isFinite(age) || age > COMMAND_TTL_MS) {
            void deleteDoc(change.doc.ref).catch(() => undefined);
            continue;
          }
          try {
            applyCommand(command);
          } catch {
            /* um comando ruim não pode derrubar o listener */
          }
          // Apagar é o que garante idempotência: ninguém reaplica.
          void deleteDoc(change.doc.ref).catch(() => undefined);
        }
      },
      () => undefined,
    );
  })().catch(() => undefined);
}

function stop(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  unsubPlayer?.();
  unsubPlayer = null;
  unsubRemote?.();
  unsubRemote = null;
  unsubCommands?.();
  unsubCommands = null;
  unsubActive?.();
  unsubActive = null;
  // Some da lista de aparelhos dos outros devices ao sair da conta.
  if (db && currentUser) {
    const uid = currentUser.uid;
    void (async () => {
      const { deleteDoc, doc } = await firestore();
      if (!db) return;
      await deleteDoc(doc(db, 'users', uid, 'devices', getDeviceId()));
    })().catch(() => undefined);
  }
  currentUser = null;
  activeDeviceId = null;
  wasPlaying = false;
  emitRemote(null);
  emitDevices([]);
}

/** Liga a presença uma única vez (App); segue o login/logout sozinha.
 *
 *  Sem guarda por `db`: o SDK do Firebase agora sobe DEPOIS do boot, então
 *  perguntar por ele aqui desligaria a presença para sempre. Quem decide é o
 *  `subscribeAuth` abaixo — ele só dispara com o SDK pronto, e `publish`/`start`
 *  já se protegem sozinhos. */
/**
 * `radinhoAparelhos()` no console: por que ESTE aparelho não aparece no outro.
 *
 * O sintoma "não mostra que estou ouvindo no celular" tem quatro causas que
 * produzem o MESMO nada, e nenhuma delas gritava:
 *
 *   1. ninguém logado aqui, ou `db` ausente — `publish` retorna na primeira
 *      linha, calado;
 *   2. a escrita é NEGADA (regra do Firestore) — o erro era descartado;
 *   3. a leitura é negada do outro lado — a lista virava vazia, igual a "não há
 *      outro aparelho";
 *   4. o sinal ENVELHECEU: quem some por mais de 180s deixa de contar como
 *      online, e o banner do outro lado cai sozinho.
 *
 * Rodar isto NOS DOIS aparelhos separa as quatro em um minuto. É a mesma lição
 * de `radinhoDiagnostico()` e `radinhoSync()`: um sintoma com muitas causas
 * silenciosas não se conserta por dedução, e este projeto já pagou por tentar.
 */
function instalarDiagnosticoDeAparelhos(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { radinhoAparelhos: () => void }).radinhoAparelhos = (): void => {
    const linhas: string[] = ['APARELHOS DA CONTA', ''];
    linhas.push(`este aparelho: ${deviceLabel()}  (id ${getDeviceId()})`);
    linhas.push(currentUser ? `logado como: ${currentUser.uid}` : '✗ NINGUÉM LOGADO aqui');
    linhas.push(db ? 'firestore: pronto' : '✗ SEM FIRESTORE (db nulo) — nada é publicado');

    if (!ultimaEscrita) {
      linhas.push('✗ este aparelho ainda NÃO publicou presença nenhuma');
    } else if (ultimaEscrita.erro) {
      linhas.push(
        `✗ última publicação FALHOU há ${Math.round((Date.now() - ultimaEscrita.em) / 1000)}s: ${ultimaEscrita.erro}`,
      );
    } else {
      linhas.push(`publicou com sucesso há ${Math.round((Date.now() - ultimaEscrita.em) / 1000)}s`);
    }
    if (ultimaLeituraErro) linhas.push(`✗ leitura da lista falhou: ${ultimaLeituraErro}`);

    linhas.push('', `aparelhos vistos (${deviceState.length}) — "online" = visto há < 180s:`);
    if (deviceState.length === 0) {
      linhas.push('  (nenhum — nem este, o que indica que a publicação não chegou)');
    }
    for (const d of deviceState) {
      const ha = Math.round((Date.now() - d.seenAt) / 1000);
      linhas.push(
        `  ${d.isSelf ? '→' : ' '} ${d.name}: ${d.online ? 'online' : 'OFFLINE'}, visto há ${ha}s` +
          `, ${d.isPlaying ? 'tocando' : 'parado'}${d.track ? ` "${d.track.title}"` : ' (sem faixa)'}`,
      );
    }
    linhas.push(
      '',
      'Para o banner aparecer no OUTRO aparelho, a linha dele aqui precisa de três',
      'coisas ao mesmo tempo: online, tocando, e com faixa. Falta qualquer uma, nada aparece.',
    );
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.log(linhas.join('\n'));
  };
}

export function initPresence(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  instalarDiagnosticoDeAparelhos();
  // O modelo real (Client Hints) chega depois; a próxima publicação já leva.
  void descobrirModelo().then(() => publish(true));
  subscribeAuth((user) => {
    stop();
    if (user) start(user);
  });
  window.addEventListener('pagehide', () => publish(true));
}
