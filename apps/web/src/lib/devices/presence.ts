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
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, subscribeAuth } from '@/lib/firebase';
import { usePlayerStore } from '@/stores/playerStore';

const DEVICE_ID_KEY = 'aurial:deviceId';
const HEARTBEAT_MS = 25_000;
/** Um device sem sinal há mais que isto é considerado offline. */
const FRESH_MS = 60_000;
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

/** Nome humano do aparelho ("Android · Chrome", "Windows · Edge"…). */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform = /iP(hone|od)/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Dispositivo';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '';
  return browser ? `${browser} · ${platform}` : platform;
}

export interface DevicePresence {
  name: string;
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
  volume: number;
  progress: number;
  duration: number;
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
export type DeviceCommandType = 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume' | 'stop';

interface DeviceCommand {
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
let initialized = false;

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
  const payload: DevicePresence = {
    name: deviceLabel(),
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
  void setDoc(doc(db, 'users', currentUser.uid, 'devices', getDeviceId()), payload).catch(
    () => undefined,
  );
}

// ── posse da reprodução ─────────────────────────────────────────

/**
 * Reivindica a posse para ESTE aparelho: os outros se pausam sozinhos ao ver
 * a mudança. Chamado quando o usuário dá play aqui ou pede "trazer para cá" —
 * sempre atrás de um gesto, que é o que o navegador exige para tocar.
 */
export function claimPlayback(): void {
  lastClaimAt = Date.now(); // abre a carência ANTES de qualquer await
  if (!db || !currentUser) return;
  activeDeviceId = getDeviceId(); // otimista: a UI reage na hora
  void setDoc(doc(db, 'users', currentUser.uid, 'state', 'activeDevice'), {
    deviceId: getDeviceId(),
    name: deviceLabel(),
    at: serverTimestamp(),
  }).catch(() => undefined);
}

/** Manda um comando para OUTRO aparelho. */
export async function sendCommand(
  toDeviceId: string,
  type: DeviceCommandType,
  value?: number,
): Promise<void> {
  if (!db || !currentUser) return;
  const payload: DeviceCommand = {
    to: toDeviceId,
    from: getDeviceId(),
    type,
    at: new Date().toISOString(),
    ...(value !== undefined ? { value } : {}),
  };
  await addDoc(collection(db, 'users', currentUser.uid, 'commands'), payload).catch(
    () => undefined,
  );
}

/**
 * Traz a reprodução para ESTE aparelho: pausa o outro, assume a posse e
 * continua a MESMA faixa na MESMA posição. Precisa ter vindo de um clique —
 * é o gesto que autoriza o navegador a tocar.
 */
export async function transferPlaybackHere(fromDeviceId?: string): Promise<void> {
  const source = fromDeviceId ?? remoteState?.deviceId;
  const device = deviceState.find((d) => d.id === source);
  if (source) await sendCommand(source, 'pause');
  claimPlayback();

  const player = usePlayerStore.getState();
  // Mesma faixa já carregada aqui: só retoma na posição do outro aparelho.
  if (device?.track && player.currentTrack) {
    if (device.progress > 0) player.seek(device.progress);
  }
  player.play();
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
    publish();
  });

  if (!db) return;

  // ── posse ────────────────────────────────────────────────────
  unsubActive = onSnapshot(
    doc(db, 'users', user.uid, 'state', 'activeDevice'),
    (snap) => {
      const data = snap.data() as { deviceId?: string; name?: string } | undefined;
      activeDeviceId = data?.deviceId ?? null;

      // SILENCIAR O USUÁRIO É O PIOR ERRO POSSÍVEL AQUI.
      //
      // A primeira versão pausava sempre que o documento apontava para outro
      // aparelho — sem olhar se aquele aparelho existe ainda. Bastava ter
      // tocado no celular ontem: hoje, no computador, o play morria na hora,
      // porque a posse antiga continuava gravada. Era exatamente o "não
      // reproduz" relatado.
      //
      // Agora só pausamos diante de um conflito REAL: o outro aparelho está
      // online E tocando agora. Em qualquer dúvida — presença desconhecida,
      // posse velha, reivindicação nossa ainda em trânsito — a música
      // continua. Dois aparelhos tocando por alguns segundos é um incômodo;
      // o app emudecer sozinho é um defeito.
      if (activeDeviceId && activeDeviceId !== getDeviceId()) {
        const player = usePlayerStore.getState();
        const dono = deviceState.find((d) => d.id === activeDeviceId);
        const conflitoReal = Boolean(dono?.online && dono.isPlaying);
        const reivindicacaoRecente = Date.now() - lastClaimAt < CLAIM_GRACE_MS;
        if (player.isPlaying && conflitoReal && !reivindicacaoRecente) {
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
      const now = Date.now();
      const devices: DeviceInfo[] = [];
      let found: RemotePlayback | null = null;
      for (const d of snap.docs) {
        const p = d.data() as DevicePresence;
        const online = now - seenMillis(p) < FRESH_MS;
        devices.push({
          id: d.id,
          name: p.name,
          isSelf: d.id === me,
          isPlaying: Boolean(p.isPlaying),
          isActive: activeDeviceId === d.id,
          online,
          track: p.track ?? null,
          volume: typeof p.volume === 'number' ? p.volume : 1,
          progress: typeof p.progress === 'number' ? p.progress : 0,
          duration: typeof p.duration === 'number' ? p.duration : 0,
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
    () => {
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
    void deleteDoc(doc(db, 'users', currentUser.uid, 'devices', getDeviceId())).catch(
      () => undefined,
    );
  }
  currentUser = null;
  activeDeviceId = null;
  wasPlaying = false;
  emitRemote(null);
  emitDevices([]);
}

/** Liga a presença uma única vez (App); segue o login/logout sozinha. */
export function initPresence(): void {
  if (initialized || typeof window === 'undefined' || !db) return;
  initialized = true;
  subscribeAuth((user) => {
    stop();
    if (user) start(user);
  });
  window.addEventListener('pagehide', () => publish(true));
}
