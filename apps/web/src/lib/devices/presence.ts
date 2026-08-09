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
import type { TrackDto } from '@aurial/shared';
import { db, subscribeAuth } from '@/lib/firebase';
import { resumeAt, usePlayerStore } from '@/stores/playerStore';

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
 * Nome do APARELHO, não do navegador — "moto g(60)", "iPhone", "Windows".
 *
 * O usuário quer saber ONDE a música está tocando, não em qual navegador. O
 * Android expõe o modelo no user-agent ("… Android 13; moto g(60) Build/…"), e é
 * ele que aparece. O iOS não expõe modelo nenhum (todo iPhone se anuncia só como
 * "iPhone"), então fica o tipo. No computador não há modelo — fica o sistema.
 */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  // Android traz o modelo real entre o número da versão e o "Build" (ou o ")").
  const android = /Android[\d.\s]*;\s*([^;)]+?)(?:\s+Build|\))/i.exec(ua);
  if (android?.[1]) {
    const modelo = android[1].replace(/\s*build.*$/i, '').trim();
    // "wv" é o marcador de WebView, não um modelo; nesse caso cai para "Android".
    if (modelo && !/^wv$/i.test(modelo)) return modelo;
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
  /** Id da faixa — é por ele que "trazer para cá" acha o que carregar. */
  trackId: string | null;
  volume: number;
  progress: number;
  duration: number;
  /** Quando este estado foi publicado (ms). A posição envelhece a partir daqui. */
  seenAt: number;
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
  const uid = currentUser.uid;
  void (async () => {
    const { doc, serverTimestamp, setDoc } = await firestore();
    if (!db) return;
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
    await setDoc(doc(db, 'users', uid, 'devices', getDeviceId()), payload);
  })().catch(() => undefined);
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
): Promise<void> {
  if (!db || !currentUser) return;
  const payload: DeviceCommand = {
    to: toDeviceId,
    from: getDeviceId(),
    type,
    at: new Date().toISOString(),
    ...(value !== undefined ? { value } : {}),
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
  const decorrido = Math.max(0, (Date.now() - device.seenAt) / 1000);
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
async function acharFaixa(trackId: string): Promise<TrackDto | null> {
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
          | { deviceId?: string; name?: string; at?: Timestamp }
          | undefined;
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
        const now = Date.now();
        const devices: DeviceInfo[] = [];
        let found: RemotePlayback | null = null;
        for (const d of snap.docs) {
          const p = d.data() as DevicePresence;
          const seenAt = seenMillis(p);
          const online = now - seenAt < FRESH_MS;
          devices.push({
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
export function initPresence(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  subscribeAuth((user) => {
    stop();
    if (user) start(user);
  });
  window.addEventListener('pagehide', () => publish(true));
}
