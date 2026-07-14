/**
 * Presença de dispositivos (estilo Spotify Connect, camada 1 — "onde está
 * tocando"). Cada aparelho logado mantém um doc em
 * `users/{uid}/devices/{deviceId}` com nome, plataforma, último sinal de vida
 * e a faixa que ESTE aparelho está tocando. Os outros aparelhos da mesma conta
 * assinam a coleção e mostram o banner "Tocando em {aparelho}" quando outro
 * device está com playback ativo — igual ao aviso verde do Spotify.
 * (Transferir o playback remotamente é a camada 2, ainda não implementada.)
 *
 * As regras do Firestore já cobrem: `users/{uid}/**` é leitura/escrita apenas
 * do próprio dono — nenhuma regra nova é necessária.
 */
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, subscribeAuth } from '@/lib/firebase';
import { usePlayerStore } from '@/stores/playerStore';

const DEVICE_ID_KEY = 'aurial:deviceId';
const HEARTBEAT_MS = 25_000;
/** Um device sem sinal há mais que isto é considerado offline. */
const FRESH_MS = 60_000;

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
  return browser ? `${platform} · ${browser}` : platform;
}

export interface DevicePresence {
  name: string;
  lastSeenAt: string;
  isPlaying: boolean;
  track: { title: string; artist: string; coverUrl: string | null } | null;
}

/** Outro aparelho da MESMA conta tocando agora (para o banner). */
export interface RemotePlayback {
  deviceName: string;
  title: string;
  artist: string;
}

let currentUser: User | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let unsubPlayer: (() => void) | null = null;
let unsubRemote: (() => void) | null = null;
let lastWriteAt = 0;
let lastSignature = '';
let initialized = false;

const remoteListeners = new Set<(remote: RemotePlayback | null) => void>();
let remoteState: RemotePlayback | null = null;

function emitRemote(next: RemotePlayback | null): void {
  const changed =
    (remoteState === null) !== (next === null) ||
    remoteState?.deviceName !== next?.deviceName ||
    remoteState?.title !== next?.title;
  remoteState = next;
  if (changed) for (const listener of remoteListeners) listener(remoteState);
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

/** Publica o estado DESTE aparelho (throttled — no máx. 1 escrita / 2s). */
function publish(force = false): void {
  if (!db || !currentUser) return;
  const state = usePlayerStore.getState();
  const track = state.currentTrack;
  const signature = `${track?.id ?? ''}|${state.isPlaying}`;
  const now = Date.now();
  if (!force && signature === lastSignature && now - lastWriteAt < HEARTBEAT_MS) return;
  if (!force && now - lastWriteAt < 2_000) return;
  lastSignature = signature;
  lastWriteAt = now;
  const payload: DevicePresence = {
    name: deviceLabel(),
    lastSeenAt: new Date().toISOString(),
    isPlaying: state.isPlaying,
    track: track
      ? {
          title: track.title,
          artist: track.artists[0]?.name ?? '',
          coverUrl: track.coverUrl,
        }
      : null,
  };
  void setDoc(doc(db, 'users', currentUser.uid, 'devices', getDeviceId()), payload).catch(
    () => undefined,
  );
}

function start(user: User): void {
  currentUser = user;
  publish(true);
  heartbeat = setInterval(() => publish(), HEARTBEAT_MS);
  // Mudou a faixa ou o play/pause → publica na hora (com o throttle de 2s).
  unsubPlayer = usePlayerStore.subscribe(() => publish());

  // Assina os aparelhos da conta e destila "outro device tocando agora".
  if (db) {
    unsubRemote = onSnapshot(
      collection(db, 'users', user.uid, 'devices'),
      (snap) => {
        const me = getDeviceId();
        let found: RemotePlayback | null = null;
        for (const d of snap.docs) {
          if (d.id === me) continue;
          const p = d.data() as DevicePresence;
          const fresh = Date.now() - new Date(p.lastSeenAt).getTime() < FRESH_MS;
          if (fresh && p.isPlaying && p.track) {
            found = { deviceName: p.name, title: p.track.title, artist: p.track.artist };
            break;
          }
        }
        emitRemote(found);
      },
      () => emitRemote(null),
    );
  }
}

function stop(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  unsubPlayer?.();
  unsubPlayer = null;
  unsubRemote?.();
  unsubRemote = null;
  // Some da lista de aparelhos dos outros devices ao sair da conta.
  if (db && currentUser) {
    void deleteDoc(doc(db, 'users', currentUser.uid, 'devices', getDeviceId())).catch(
      () => undefined,
    );
  }
  currentUser = null;
  emitRemote(null);
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
