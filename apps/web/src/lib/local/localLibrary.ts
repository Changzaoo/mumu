/**
 * Local library — the user's OWN tracks (imported files + tracks received from
 * peers over P2P). Mirrors the offline-download pattern:
 *
 *   audio bytes → Cache Storage (`aurial-library-v1`)
 *   metadata    → localStorage index (`aurial:library`)
 *   playback    → in-memory `Map<id, objectUrl>` the AudioEngine resolver reads
 *
 * Local tracks carry `streamUrl = null`; they only play because the player's
 * local-source resolver returns their object URL (see stores/playerStore.ts).
 * Works fully offline and, on secure origins, survives reloads via Cache Storage.
 */
import type { SharedTrackMeta, TrackDto } from '@aurial/shared';
import {
  cacheStorageSupported,
  deleteAudio,
  deleteCover,
  getAudioBlob,
  getCoverBlob,
  putAudio,
  putCover,
} from '@/lib/offline/audioCache';
import { cloudCollection } from '@/lib/sync/cloudCollection';
import { publishSharedTrack } from '@/lib/sync/sharedLibrary';
import { queueLyricsSync } from '@/lib/lyrics/syncFromAudio';
import { pushNotification } from '@/stores/notificationsStore';
import { safeCoverUrl, sanitizeText, validateAudioFile } from '@/lib/local/validateAudio';
import { creditIsAmbiguous, splitArtistNames } from '@/lib/local/artists';
import { aiSplitArtists, aiVerifyArtist } from '@/lib/ai/ai';
// O TIME DE METADADOS (5 agentes — ver metaTeam.ts). Aqui vive o AUDITOR;
// os demais agentes são consultados em cada decisão de crédito.
import {
  extrator,
  juizCreditoConflita,
  juizDecideCredito,
  verificadorAlbum,
  verificadorConfirma,
  verificadorPorTitulo,
} from '@/lib/local/metaTeam';
import { parseTrackFileName } from '@/lib/local/enrich';
import { readAudioTags } from '@/lib/local/audioTags';
import { artistFromSource } from '@/lib/local/sourceArtist';
import { appleArtwork, searchSongsForArtwork } from '@/lib/catalog/itunes';
import {
  candidateArtists,
  fetchAppleCatalog,
  indexCatalog,
  matchInCatalog,
} from '@/lib/local/catalogMatch';
import {
  bumpCoverAttempt,
  countPendingCovers,
  isMissingCover,
  isMissingCredits,
  normalizeForMatch,
  pickArtworkMatch,
  pickBackfillCandidates,
  readCoverAttempts,
  resetCoverAttempts,
  scoreArtworkMatch,
  titleSearchCandidates,
} from '@/lib/local/coverBackfill';
import {
  buildStreamUrl,
  deleteTrackBlob,
  fetchArtistCatalog,
  fetchCover,
  fetchCredits,
  fetchPlaylistEntries,
  fetchTrackMeta,
  helperSupportsMetaTeam,
  importerHostLabel,
  importViaHelper,
  uploadTrackBlob,
} from '@/lib/local/importerHelper';

const CACHE_NAME = 'aurial-library-v1';
const STORAGE_KEY = 'aurial:library';
const keyFor = (id: string): string => `/__library_audio__/${encodeURIComponent(id)}`;

export interface LibraryEntry {
  track: TrackDto;
  addedAt: string;
  sizeBytes: number;
  mimeType: string;
  /** Original media link (YouTube/direct file) — lets any device re-import it. */
  sourceUrl?: string;
  /** Importer capability URL for the uploaded audio — lets ANY device stream it. */
  remoteUrl?: string;
  /** SHA-256 of the audio bytes — catches identical files imported twice. */
  contentHash?: string;
}

// ── in-memory state ─────────────────────────────────────────────
const blobUrls = new Map<string, string>();
const listeners = new Set<() => void>();
let cache: LibraryEntry[] | null = null;
/** Derivados caros (álbuns/artistas/gêneros) memoizados até a próxima write() —
 *  Sidebar + Home consultam a cada render e recalcular O(n) toda vez derrubava
 *  celulares modestos. */
let groupsCache: { albums: LocalAlbum[]; artists: LocalArtist[]; genres: LocalGenre[] } | null =
  null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── registry (localStorage) ─────────────────────────────────────
function read(): LibraryEntry[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as LibraryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

// A cura/enriquecimento em segundo plano faz patch de UMA faixa por vez; com a
// persistência síncrona antiga cada patch custava JSON.stringify da biblioteca
// INTEIRA (megabytes) + localStorage.setItem + re-render do app todo — centenas
// em sequência CONGELAVAM a página (até "Página sem resposta"). O debounce
// coalesce rajadas em uma escrita/emissão a cada ~300ms; a memória (cache) é
// atualizada na hora, então toda leitura continua vendo o estado novo.
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * O que pode ir para o localStorage.
 *
 * Duas capas jamais podem ser persistidas aqui:
 *  - `blob:` — morre com a aba; ao voltar seria uma URL quebrada;
 *  - `data:` grande — o registro é UM JSON com cota de ~5 MB, e uma capa
 *    embutida vira ~1 MB em base64. Cinco faixas estouram a cota, o setItem
 *    falha EM SILÊNCIO e a biblioteca inteira deixa de persistir — o usuário
 *    perde os imports recentes no próximo boot. A imagem mora no IndexedDB
 *    (putCover); aqui fica só o marcador `hasEmbeddedCover`.
 */
const MAX_INLINE_COVER = 8 * 1024; // data URL minúscula (ícone) ainda passa

function storableEntry(entry: LibraryEntry): LibraryEntry {
  const cover = entry.track.coverUrl;
  if (!cover) return entry;
  const ephemeral = cover.startsWith('blob:');
  const tooBig = cover.startsWith('data:') && cover.length > MAX_INLINE_COVER;
  if (!ephemeral && !tooBig) return entry;
  return { ...entry, track: { ...entry.track, coverUrl: null } };
}

function flushWrite(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify((cache ?? []).map(storableEntry)));
  } catch {
    // Quota / private mode — registry stays in memory for the session.
  }
  emit();
}

function write(entries: LibraryEntry[]): void {
  cache = entries;
  groupsCache = null; // seletores derivados (álbuns/artistas/gêneros) recalculam
  writeTimer ??= setTimeout(flushWrite, 300);
}

// Não perder a rajada final se a aba fechar dentro da janela do debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (writeTimer) flushWrite();
  });
}

// ── Cache Storage helpers ───────────────────────────────────────
// A Cache Storage SÓ existe em contexto seguro (https/localhost). Num endereço
// http:// de LAN — exatamente o caso "abrir no celular" — ela some, e antes
// disso `putBlob` era um no-op SILENCIOSO: a faixa entrava no registro, tocava
// na sessão e sumia no reload, sem nunca poder tocar offline. O IndexedDB
// funciona em qualquer contexto, então ele é o fallback para os bytes.
/**
 * Grava os bytes e CONFERE que ficaram gravados.
 *
 * A versão anterior tinha dois furos que, juntos, faziam a faixa evaporar sem
 * ninguém notar: quando o Cache Storage existia ele era a única tentativa (um
 * `put` que estourasse a cota se perdia, sem cair para o IndexedDB), e os três
 * pontos de importação chamavam isto com `.catch(() => undefined)` — a rejeição
 * ia para o lixo. Como `addEntry` cria o object URL de qualquer jeito, a faixa
 * TOCAVA na aba aberta e só sumia no reload seguinte. Daí o relato "as últimas
 * que adicionei estão indisponíveis": num lote, a cota estoura no meio e são
 * justamente as últimas que se perdem.
 *
 * Agora: tenta Cache Storage, confere lendo de volta, e cai para o IndexedDB
 * (que tem cota própria) se qualquer etapa falhar. Só resolve com prova de que
 * os bytes estão lá; caso contrário LANÇA, e quem importou decide o que dizer
 * ao usuário — nunca mais um sucesso fingido.
 */
async function putBlob(id: string, blob: Blob): Promise<void> {
  const viaIndexedDb = async (): Promise<void> => {
    await putAudio(id, blob); // funciona em http:// e tem cota separada
    const gravado = await getAudioBlob(id).catch(() => null);
    if (!gravado) throw new Error('Não foi possível guardar o áudio neste aparelho.');
  };

  if (!cacheStorageSupported()) {
    await viaIndexedDb();
    return;
  }

  try {
    const store = await caches.open(CACHE_NAME);
    await store.put(
      keyFor(id),
      new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'audio/mpeg',
          'Content-Length': String(blob.size),
        },
      }),
    );
    // Conferência real: sob pressão de cota o navegador pode aceitar o put e
    // despejar a entrada logo depois. Sem ler de volta, "gravado" é suposição.
    const res = await store.match(keyFor(id));
    if (res) return;
  } catch {
    // cai para o IndexedDB abaixo
  }
  await viaIndexedDb();
}

async function getBlob(id: string): Promise<Blob | null> {
  if (!cacheStorageSupported()) return getAudioBlob(id);
  const store = await caches.open(CACHE_NAME);
  const res = await store.match(keyFor(id));
  if (res) return await res.blob();
  // Importada num contexto não-seguro anterior → bytes estão no IndexedDB.
  return getAudioBlob(id);
}

async function deleteBlob(id: string): Promise<void> {
  await deleteAudio(id).catch(() => undefined); // limpa a cópia IndexedDB
  if (!cacheStorageSupported()) return;
  const store = await caches.open(CACHE_NAME);
  await store.delete(keyFor(id));
}

// ── capas embutidas ─────────────────────────────────────────────
/** Object URLs das capas guardadas no IndexedDB (reconstruídos a cada boot). */
const coverUrls = new Map<string, string>();

/**
 * Guarda a capa embutida como BLOB e devolve um object URL para usar agora.
 * Devolve null se algo falhar — capa é enfeite, jamais pode impedir o import.
 */
async function storeEmbeddedCover(id: string, dataUrl: string): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size === 0) return null;
    await putCover(id, blob);
    const url = URL.createObjectURL(blob);
    coverUrls.set(id, url);
    return url;
  } catch {
    return null;
  }
}

/** SHA-256 of the audio bytes (hex) — identifies identical files. */
async function hashBlob(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// ── duration probing ────────────────────────────────────────────
/** Read an audio blob's duration via a metadata-only decode probe (ms). */
function probeDurationMs(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'metadata';
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(ms) && ms > 0 ? ms : 0);
    };
    el.addEventListener('loadedmetadata', () => finish(el.duration * 1000));
    el.addEventListener('error', () => finish(0));
    // Safety net: never hang on an undecodable file.
    setTimeout(() => finish(el.duration * 1000), 8000);
    el.src = url;
  });
}

/** Ficha extra da faixa — o que não cabe nos parâmetros posicionais acima. */
interface LocalTrackExtras {
  /** Quem escreveu a música (tag TCOM / catálogo). */
  composer?: string | null;
  /** Gravadora / selo (tag TPUB). */
  label?: string | null;
  releaseYear?: number | null;
}

function localTrackDto(
  id: string,
  title: string,
  artist: string | string[],
  durationMs: number,
  album: string | null,
  coverUrl: string | null,
  extras: LocalTrackExtras = {},
): TrackDto {
  // Sanitize every externally-derived string/URL that lands in a track.
  const safeTitle = sanitizeText(title) || 'Faixa';
  // A credit can name several artists ("A feat. B", "A & B"). Split it so the
  // track is attributed to EACH artist — never merged into one.
  const rawNames = Array.isArray(artist) ? artist : splitArtistNames(artist);
  const names = rawNames.map((n) => sanitizeText(n, 120)).filter(Boolean);
  const safeNames = names.length > 0 ? names : ['Desconhecido'];
  const safeAlbum = album ? sanitizeText(album, 200) || null : null;
  const cover = safeCoverUrl(coverUrl);
  return {
    id,
    title: safeTitle,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: cover,
    dominantColor: null,
    loudnessLufs: null,
    album: safeAlbum
      ? { id: `local-album:${id}`, title: safeAlbum, slug: '', coverUrl: cover }
      : null,
    artists: safeNames.map((name, i) => ({
      id: `local-artist:${id}:${i}`,
      name,
      slug: '',
      imageUrl: null,
    })),
    composer: extras.composer ? sanitizeText(extras.composer, 200) || null : null,
    label: extras.label ? sanitizeText(extras.label, 120) || null : null,
    // Ano fora da faixa do plausível é metadata podre — melhor não exibir nada.
    releaseYear:
      extras.releaseYear && extras.releaseYear > 1800 && extras.releaseYear < 2200
        ? extras.releaseYear
        : null,
    streamUrl: null,
    downloadUrl: null,
    uploadedByUserId: null,
  };
}

function addEntry(entry: LibraryEntry, blob: Blob): void {
  blobUrls.set(entry.track.id, URL.createObjectURL(blob));
  write([entry, ...read().filter((e) => e.track.id !== entry.track.id)]);
  // NUNCA sincronizar object URL: ele só vale nesta aba, e no outro aparelho
  // viraria uma capa morta que ainda por cima BLOQUEIA a reidratação (a
  // restauração pula quem já tem coverUrl não-nulo).
  cloud.push(entry.track.id, storableEntry(entry));
}

/**
 * Upload a freshly-added track's audio to the importer and record the resulting
 * stream URL on its entry (as `remoteUrl` + `track.streamUrl`) so the user's
 * OTHER devices — which only sync metadata — can play it. Best-effort: silent on
 * failure / when signed out (the track just stays local-only, as before).
 */
async function uploadAndLink(id: string, blob: Blob): Promise<void> {
  const url = await uploadTrackBlob(id, blob);
  if (!url) return;
  const current = read().find((e) => e.track.id === id);
  if (!current) return; // removed while uploading
  patchEntry(id, {
    ...current,
    remoteUrl: url,
    track: { ...current.track, streamUrl: url },
  });
}

/**
 * O player reporta uma cópia enviada (remoteUrl) MORTA — o cofre a perdeu
 * (eviction LRU, disco fora do ar). Limpa a URL da entrada (a metadata
 * sincroniza e TODOS os aparelhos param de pagar o hop morto a cada play) e,
 * se ESTE aparelho tiver o áudio, re-envia na hora para curar o cofre.
 * Best-effort e estritamente guardado: só age quando a URL morta é exatamente
 * a registrada.
 */
export function reportDeadRemote(id: string, deadUrl: string): void {
  const entry = read().find((e) => e.track.id === id);
  if (!entry || entry.remoteUrl !== deadUrl) return;
  const { remoteUrl: _dead, ...rest } = entry;
  patchEntry(id, {
    ...rest,
    track: {
      ...entry.track,
      streamUrl: entry.track.streamUrl === deadUrl ? null : entry.track.streamUrl,
    },
  });
  void (async () => {
    const blob = await blobFor(id).catch(() => null);
    if (blob) await uploadAndLink(id, blob);
  })();
}

// ── cross-device sync (Firestore, metadata only) ────────────────
// Only the registry (track + metadata) syncs. The audio bytes stay on the
// device that has them; a synced-in entry simply isn't playable elsewhere until
// its file is re-imported/received (the user opted for library-only sync).
const cloud = cloudCollection<LibraryEntry>({
  name: 'library',
  localItems: () => read().map((e): [string, LibraryEntry] => [e.track.id, e]),
  onRemoteUpsert: (id, entry) => applyRemoteUpsert(id, entry),
  onRemoteDelete: (id) => applyRemoteDelete(id),
});

/** Start/stop cross-device sync (called on auth change). */
export const setUser = cloud.setUser;

function applyRemoteUpsert(id: string, entry: LibraryEntry): void {
  const existing = read();
  // A entrada remota não conhece a capa DESTE aparelho (a imagem embutida
  // mora no IndexedDB local e nunca é sincronizada). Sem preservar a capa já
  // restaurada, cada eco da nuvem apagaria a capa da tela — o sintoma clássico
  // de "a capa aparece no boot e some sozinha depois".
  const localCover = coverUrls.get(id);
  const merged =
    localCover && !entry.track.coverUrl
      ? { ...entry, track: { ...entry.track, coverUrl: localCover } }
      : entry;
  write(
    existing.some((e) => e.track.id === id)
      ? existing.map((e) => (e.track.id === id ? merged : e))
      : [merged, ...existing],
  );
}

function applyRemoteDelete(id: string): void {
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
  write(read().filter((e) => e.track.id !== id));
}

// ── public API ──────────────────────────────────────────────────

/** Import dropped/picked audio files into the local library. */
export async function importFiles(files: File[]): Promise<TrackDto[]> {
  const imported: TrackDto[] = [];
  /** Arquivos que não couberam no armazenamento — o usuário precisa saber. */
  const falhas: string[] = [];
  for (const file of files) {
    // Reject anything that isn't genuinely audio (magic-byte sniff + size cap).
    const check = await validateAudioFile(file);
    if (!check.ok) continue;
    // Skip an identical file already in the library (same audio bytes).
    const hash = await hashBlob(file);
    const dup = hash ? findByHash(hash) : null;
    if (dup) {
      imported.push(dup);
      continue;
    }
    const id = `local:${crypto.randomUUID()}`;
    // As TAGS EMBUTIDAS mandam no nome do arquivo: elas foram escritas por quem
    // produziu/rippou o arquivo (evidência de fonte, como o yt-dlp), enquanto o
    // nome é o que sobrou depois de passar por downloads, WhatsApp e renomeios.
    // É também a única chance de já nascer com álbum, compositor e capa reais.
    const tags = await readAudioTags(file);
    const fromName = parseTrackFileName(file.name);
    const title = tags.title ?? fromName.title;
    const artist = tags.artist ?? fromName.artist ?? 'Desconhecido';
    const durationMs = await probeDurationMs(file);
    const mimeType = file.type || 'audio/mpeg';
    // A capa embutida vai para o IndexedDB e vira object URL — NUNCA data URL
    // no registro (ver storableEntry: estouraria a cota e derrubaria a
    // persistência da biblioteca inteira em silêncio).
    const coverUrl = tags.coverDataUrl ? await storeEmbeddedCover(id, tags.coverDataUrl) : null;
    const track = localTrackDto(id, title, artist, durationMs, tags.album, coverUrl, {
      composer: tags.composer,
      label: tags.publisher,
      releaseYear: tags.year,
    });

    // Num LOTE, a cota costuma estourar no meio: as primeiras entram e as
    // últimas não. Por isso o erro é tratado por arquivo — abortar o lote
    // inteiro perderia importações que já deram certo. O que não se faz mais é
    // registrar a faixa mesmo assim: sem bytes gravados ela tocaria só nesta
    // aba e apareceria "indisponível" no próximo reload.
    try {
      await putBlob(id, file);
    } catch {
      falhas.push(title);
      continue;
    }
    addEntry(
      {
        track,
        addedAt: new Date().toISOString(),
        sizeBytes: file.size,
        mimeType,
        ...(hash ? { contentHash: hash } : {}),
      },
      file,
    );
    void uploadAndLink(id, file); // make it playable on the user's other devices
    imported.push(track);
  }
  if (falhas.length) {
    const quantas =
      falhas.length === 1 ? `"${falhas[0]}" não coube` : `${falhas.length} faixas não couberam`;
    void import('sonner').then(({ toast }) =>
      toast.error(`${quantas} no armazenamento deste aparelho. Libere espaço e tente de novo.`),
    );
  }
  // Non-blocking: fetch real covers/metadata from iTunes for what we just added.
  void enrichSequentially(imported.map((t) => t.id));
  if (imported.length > 0) {
    pushNotification({
      type: 'import',
      title: imported.length === 1 ? 'Faixa importada' : `${imported.length} faixas importadas`,
      body: imported.length === 1 ? imported[0]?.title : undefined,
    });
  }
  return imported;
}

/** Persist a track received from a peer over the data channel. */
export async function saveReceivedTrack(meta: SharedTrackMeta, blob: Blob): Promise<TrackDto> {
  // Re-namespace under our own local id so it is owned and re-shareable.
  const id = meta.id.startsWith('local:') ? meta.id : `local:${crypto.randomUUID()}`;
  const track = localTrackDto(
    id,
    meta.title,
    meta.artist,
    meta.durationMs,
    meta.album,
    meta.coverDataUrl,
  );
  await putBlob(id, blob); // falha aqui PRECISA subir: sem bytes não há faixa
  addEntry(
    { track, addedAt: new Date().toISOString(), sizeBytes: blob.size, mimeType: meta.mimeType },
    blob,
  );
  void uploadAndLink(id, blob);
  pushNotification({ type: 'shared', title: 'Faixa recebida de um amigo', body: track.title });
  return track;
}

// ── enrichment (real covers + metadata from iTunes) ─────────────

/** Replace a registry entry in place, preserving its list position. */
function patchEntry(id: string, next: LibraryEntry): void {
  write(read().map((e) => (e.track.id === id ? next : e)));
  cloud.push(id, storableEntry(next)); // nunca sincronizar object URL — ver addEntry
}

/**
 * Look up + verify a track's real metadata and update its entry. ACCURACY FIRST:
 * the AI only proposes a cleaner title + an artist HINT — iTunes is the authority
 * that must CONFIRM the artist (and genre) before we attribute it. If iTunes
 * can't confirm (no title match, or the title is shared by several artists), we
 * leave the track exactly as-is rather than crediting the wrong artist/genre.
 * Returns true only when a verified match was applied. Also the manual
 * "buscar capa" retry. Never throws; keeps the audio + id unchanged.
 */
export async function enrichLocalTrack(id: string): Promise<boolean> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return false;
  // Hint = the artist we already have (from the filename / a prior confirmed
  // match) — NEVER an AI guess (that hallucinated, e.g. Charlie Brown → Geraldo
  // Azevedo). iTunes is the authority and must confirm the artist (strict title
  // match) before we attribute it. The AI's role is a separate periodic audit.
  const currentArtist = entry.track.artists
    .map((a) => a.name)
    .filter((n) => n && n !== 'Desconhecido')[0];

  // VERIFICADOR (metaTeam): confirma no iTunes só com um palpite sustentado por
  // evidência — sem artista conhecido ele se recusa a procurar (buscar por
  // título sozinho é o que fabricava créditos errados).
  // Sem artista nenhum não há crédito a proteger — e desistir aqui era o que
  // condenava o arquivo solto ("audio.mp3") a ficar sem capa/álbum/letra para
  // sempre. A lente de TÍTULO entra só nesse caso, e com prova alta.
  const verified =
    (await verificadorConfirma(entry.track.title, currentArtist)) ??
    (await verificadorPorTitulo(entry.track.title, currentArtist));
  const current = read().find((e) => e.track.id === id);
  if (!current) return false;

  if (!verified) return false; // couldn't confirm → NEVER guess; leave as-is

  const base = localTrackDto(
    id,
    verified.title,
    verified.artists, // iTunes-authoritative, split into distinct artists
    current.track.durationMs,
    verified.album,
    verified.coverUrl ?? current.track.coverUrl,
    {
      // O catálogo refina, mas não apaga: compositor/selo/ano lidos da tag do
      // arquivo continuam valendo quando o iTunes não informa os dele.
      composer: verified.composer ?? current.track.composer,
      label: current.track.label,
      releaseYear: current.track.releaseYear,
    },
  );
  const track: TrackDto = {
    ...base,
    genre: verified.genre ?? current.track.genre ?? null, // iTunes genre only
    streamUrl: current.remoteUrl ?? current.track.streamUrl,
  };
  patchEntry(id, { ...current, track });
  // Nome corrigido → busca a letra certa e, com o áudio já no aparelho,
  // também a sincronia (fila serial em segundo plano).
  queueLyricsSync(track);
  if (current.sourceUrl) void publishSharedTrack(track, current.sourceUrl);
  return true;
}

/** AGENTE DE CATEGORIAS: aplica um gênero classificado a uma faixa (patch
 *  mínimo — não mexe em crédito/capa; ver lib/local/genreAgent.ts). */
export function setTrackGenre(id: string, genre: string): void {
  const cur = read().find((e) => e.track.id === id);
  if (!cur || cur.track.genre === genre) return;
  patchEntry(id, { ...cur, track: { ...cur.track, genre } });
}

/** Enrich a list of ids one at a time (gentle on the iTunes endpoint). */
async function enrichSequentially(ids: string[]): Promise<void> {
  for (const id of ids) {
    const applied = await enrichLocalTrack(id).catch(() => false);
    if (applied) continue;
    // O catálogo não confirmou, mas a TAG do arquivo pode já ter dado um nome
    // bom o bastante para achar a letra — só não vale gastar a busca com
    // "Desconhecido", que nunca casa com nada no LRCLIB.
    const entry = read().find((e) => e.track.id === id);
    const artist = entry?.track.artists[0]?.name;
    if (entry && artist && artist !== 'Desconhecido') queueLyricsSync(entry.track);
  }
}

// ── add by direct URL ───────────────────────────────────────────

/** Streaming-platform PAGE hosts we must refuse (never scrape/resolve). */
const STREAMING_HOSTS: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /(^|\.)spotify\.com$/i, label: 'Spotify' },
  { match: /(^|\.)youtube\.com$/i, label: 'YouTube' },
  { match: /(^|\.)youtu\.be$/i, label: 'YouTube' },
  { match: /(^|\.)youtube-nocookie\.com$/i, label: 'YouTube' },
  { match: /(^|\.)soundcloud\.com$/i, label: 'SoundCloud' },
  { match: /(^|\.)deezer\.com$/i, label: 'Deezer' },
  { match: /(^|\.)tidal\.com$/i, label: 'Tidal' },
  { match: /(^|\.)music\.apple\.com$/i, label: 'Apple Music' },
];

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;

/** Store an audio blob as a local track (shared path for imports + URLs). */
async function saveBlobAsLocalTrack(
  blob: Blob,
  opts: {
    title: string;
    sourceUrl?: string;
    coverUrl?: string | null;
    /** Real metadata from yt-dlp (YouTube Music) — trusted over title parsing. */
    artist?: string | null;
    track?: string | null;
    album?: string | null;
    /** Channel/uploader — the artist identity for underground/self-published tracks. */
    uploader?: string | null;
  },
): Promise<TrackDto> {
  // Dedup: same source link, or byte-identical audio already in the library.
  if (opts.sourceUrl) {
    const bySource = findBySource(opts.sourceUrl);
    if (bySource) return bySource;
  }
  const hash = await hashBlob(blob);
  if (hash) {
    const byHash = findByHash(hash);
    if (byHash) return byHash;
  }
  const id = `local:${crypto.randomUUID()}`;
  // TIME DE METADADOS: o EXTRATOR consolida as evidências da fonte (yt-dlp +
  // canal do uploader, via CURADOR) e o JUIZ decide o crédito por precedência —
  // fonte > "Artista - Título" > canal. Faixa underground num canal de artista
  // ("MILAGRE" no canal Brandão85) sai creditada ao canal, nunca "Desconhecido".
  const ev = extrator({
    artist: opts.artist,
    track: opts.track,
    album: opts.album,
    uploader: opts.uploader,
    title: opts.title,
  });
  const credito = juizDecideCredito(ev);
  // VERIFICADOR — lente de álbum: quando a fonte cita um álbum, identifica o
  // álbum REAL no catálogo e adota artista/capa autoritativos (só com a faixa
  // comprovadamente na tracklist).
  const albumVer = await verificadorAlbum(ev).catch(() => null);
  const durationMs = await probeDurationMs(blob);
  const mimeType = blob.type || 'audio/mpeg';
  // Seed with the source thumbnail (e.g. YouTube cover) so it's never blank;
  // enrichment may upgrade it to a clean album cover afterwards.
  const track = localTrackDto(
    id,
    credito.title,
    albumVer?.artist ?? credito.artist,
    durationMs,
    albumVer?.album ?? credito.album,
    albumVer?.coverUrl ?? opts.coverUrl ?? null,
  );
  await putBlob(id, blob); // falha aqui PRECISA subir: sem bytes não há faixa
  addEntry(
    {
      track,
      addedAt: new Date().toISOString(),
      sizeBytes: blob.size,
      mimeType,
      ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
      ...(hash ? { contentHash: hash } : {}),
    },
    blob,
  );
  void uploadAndLink(id, blob);
  return track;
}

/**
 * Add a track from a DIRECT audio-file URL. Refuses streaming-platform pages
 * (never scrapes them), downloads the file in-browser, validates it is audio,
 * stores it locally and enriches its cover/metadata. Throws friendly pt-BR
 * errors the caller shows as a toast.
 */
export async function addByUrl(url: string, opts: { silent?: boolean } = {}): Promise<TrackDto> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Cole um link válido (que comece com http:// ou https://).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Cole um link válido (que comece com http:// ou https://).');
  }

  const host = parsed.hostname.toLowerCase();

  // Media pages (YouTube, SoundCloud, Vimeo, Bandcamp…): a browser cannot fetch
  // their audio directly (CORS + player signature). If the user is running the
  // local importer helper (apps/importer), route the link through it — it fetches
  // + converts to MP3 on their own machine and we store it like any local track.
  if (importerHostLabel(host)) {
    const imported = await importViaHelper(parsed.toString());
    const track = await saveBlobAsLocalTrack(imported.blob, {
      title: `${imported.title}.mp3`,
      sourceUrl: parsed.toString(),
      coverUrl: imported.coverUrl,
      artist: imported.artist,
      track: imported.track,
      album: imported.album,
      uploader: imported.uploader,
    });
    void enrichLocalTrack(track.id).catch(() => undefined);
    void publishSharedTrack(track, parsed.toString()); // share with the community
    if (!opts.silent)
      pushNotification({ type: 'import', title: 'Música baixada', body: track.title });
    return track;
  }

  // Other streaming platforms we can't (and won't) resolve.
  const streaming = STREAMING_HOSTS.find((s) => s.match.test(host));
  if (streaming) {
    throw new Error(
      `Não dá para importar do ${streaming.label} por aqui. Cole o link direto de um arquivo de áudio ou importe o arquivo.`,
    );
  }

  const blockedMessage =
    'Não consegui baixar desse link pelo navegador (o servidor pode bloquear). Baixe o arquivo e importe em “Importar arquivos”.';
  let res: Response;
  try {
    res = await fetch(parsed.toString());
  } catch {
    throw new Error(blockedMessage);
  }
  if (!res.ok) throw new Error(blockedMessage);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const isAudio = contentType.startsWith('audio/') || AUDIO_EXT.test(parsed.pathname);
  if (!isAudio) {
    throw new Error('Esse link não parece ser um arquivo de áudio.');
  }

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error('Esse link não parece ser um arquivo de áudio.');
  }

  const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'faixa');
  const track = await saveBlobAsLocalTrack(blob, { title: fileName, sourceUrl: parsed.toString() });
  void enrichLocalTrack(track.id).catch(() => undefined);
  void publishSharedTrack(track, parsed.toString()); // share with the community
  if (!opts.silent)
    pushNotification({ type: 'import', title: 'Música baixada', body: track.title });
  return track;
}

/**
 * Import a whole playlist by link: enumerate its entries via the importer, then
 * import each track through the normal path (covers, lyrics, community share).
 * Reports progress; a single summary notification is pushed at the end.
 */
export async function addPlaylistByUrl(
  url: string,
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<{ imported: number; total: number }> {
  const { entries } = await fetchPlaylistEntries(url);
  if (entries.length === 0) throw new Error('Não encontramos faixas nessa playlist.');

  let imported = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    onProgress?.(i, entries.length, entry.title);
    try {
      await addByUrl(entry.url, { silent: true });
      imported += 1;
    } catch {
      /* skip a failed entry, keep going */
    }
  }
  pushNotification({
    type: 'import',
    title: 'Playlist importada',
    body: `${imported} de ${entries.length} faixas adicionadas`,
  });
  return { imported, total: entries.length };
}

export function list(): LibraryEntry[] {
  return read();
}

export function has(id: string): boolean {
  return read().some((e) => e.track.id === id);
}

/** A locally-stored track imported from the same source URL, if any. */
export function findBySource(sourceUrl: string): TrackDto | null {
  return read().find((e) => e.sourceUrl === sourceUrl)?.track ?? null;
}

/** A locally-stored track with byte-identical audio, if any. */
export function findByHash(hash: string): TrackDto | null {
  return read().find((e) => e.contentHash === hash)?.track ?? null;
}

/** A library track matching this title (+ artist), if you own it — for showing
 *  which album tracks are already in your library. */
export function findOwnedTrack(title: string, artist?: string): TrackDto | null {
  const t = normName(title);
  if (!t) return null;
  const a = artist ? normName(artist) : '';
  for (const e of read()) {
    if (normName(e.track.title) !== t) continue;
    if (a && !e.track.artists.some((x) => normName(x.name) === a)) continue;
    return e.track;
  }
  return null;
}

/** The original import link for a local track (for streaming on a device without the audio). */
export function sourceUrlFor(id: string): string | null {
  return read().find((e) => e.track.id === id)?.sourceUrl ?? null;
}

/** The uploaded-audio stream URL for a local track, if it was uploaded. */
export function remoteUrlFor(id: string): string | null {
  return read().find((e) => e.track.id === id)?.remoteUrl ?? null;
}

/** Os bytes desta faixa estão mesmo no cofre deste aparelho? Diferente de
 *  `localAudioUrl`, que só diz se o object URL foi criado NESTA sessão. */
export async function hasStoredAudio(id: string): Promise<boolean> {
  const blob = await getBlob(id).catch(() => null);
  return Boolean(blob && blob.size > 0);
}

/** A entrada do registro, para diagnóstico. */
export function entryFor(id: string): LibraryEntry | null {
  return read().find((e) => e.track.id === id) ?? null;
}

/** Faixas do registro cujo áudio NÃO está neste aparelho. */
export function tracksMissingAudio(): LibraryEntry[] {
  return read().filter((e) => !blobUrls.has(e.track.id));
}

/**
 * Traz de volta o áudio das faixas que ficaram sem bytes gravados.
 *
 * NUNCA chamar no boot. Isto já rodou automaticamente e foi um estrago: "sem
 * áudio local" é a condição NORMAL de toda faixa num aparelho que não a
 * importou — no celular, onde só chega metadata sincronizada, a lista de
 * "faixas a reparar" é a biblioteca inteira. O que devia ser um conserto virou
 * o telefone baixando centenas de músicas no boot, enchendo o armazenamento de
 * um aparelho que deveria apenas transmitir.
 *
 * É uma ferramenta MANUAL, para o aparelho que de fato importou as faixas e
 * perdeu os bytes. Duas fontes, nesta ordem: a cópia enviada ao importador
 * (mesmo arquivo, mais barata) e, na falta dela, o link de origem. Devolve
 * quantas voltaram a tocar.
 */
export async function repairMissingAudio(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  let recuperadas = 0;

  for (const entry of tracksMissingAudio()) {
    const id = entry.track.id;

    // Pode já estar no cofre local e só faltar o object URL desta sessão —
    // nesse caso não há o que baixar.
    const local = await getBlob(id).catch(() => null);
    if (local) {
      blobUrls.set(id, URL.createObjectURL(local));
      recuperadas += 1;
      continue;
    }

    const fontes = [
      entry.remoteUrl,
      entry.sourceUrl ? await buildStreamUrl(entry.sourceUrl) : null,
    ];
    for (const url of fontes) {
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.size) continue;
        await putBlob(id, blob); // já confere que ficou gravado
        blobUrls.set(id, URL.createObjectURL(blob));
        recuperadas += 1;
        break;
      } catch {
        // tenta a próxima fonte
      }
    }
    await descanso(200);
  }

  if (recuperadas) emit();
  return recuperadas;
}

// ── album / artist organization (Spotify-style, all from local metadata) ──
function normName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface LocalAlbum {
  key: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  tracks: TrackDto[];
}

const albumKey = (title: string, artist: string): string =>
  `${normName(title)}|${normName(artist)}`;

/**
 * Group library tracks into real albums. A track counts as an album only when
 * its album has 2+ tracks OR the album name differs from the track name (a
 * genuine release, not an auto "Title - Single"). Everything else is a single.
 */
function computeAlbumGroups(): LocalAlbum[] {
  const byKey = new Map<string, LocalAlbum>();
  for (const entry of read()) {
    const t = entry.track;
    const title = t.album?.title?.trim();
    if (!title) continue;
    const artist = t.artists[0]?.name?.trim() || 'Desconhecido';
    const key = albumKey(title, artist);
    let album = byKey.get(key);
    if (!album) {
      album = { key, title, artist, coverUrl: t.coverUrl ?? null, tracks: [] };
      byKey.set(key, album);
    }
    album.tracks.push(t);
    if (!album.coverUrl && t.coverUrl) album.coverUrl = t.coverUrl;
  }
  return [...byKey.values()].filter(
    (a) => a.tracks.length >= 2 || normName(a.title) !== normName(a.tracks[0]?.title ?? ''),
  );
}

/** Memo dos derivados — recalcula UMA vez por mudança da biblioteca. */
function ensureGroups(): NonNullable<typeof groupsCache> {
  return (groupsCache ??= {
    albums: computeAlbumGroups(),
    artists: computeArtists(),
    genres: computeGenreGroups(),
  });
}

export function albumGroups(): LocalAlbum[] {
  return ensureGroups().albums;
}

export function albumByKey(key: string): LocalAlbum | null {
  return albumGroups().find((a) => a.key === key) ?? null;
}

/** Tracks that aren't part of a real album (singles + album-less). */
export function singles(): TrackDto[] {
  const inAlbum = new Set<string>();
  for (const album of albumGroups()) for (const t of album.tracks) inAlbum.add(t.id);
  return read()
    .map((e) => e.track)
    .filter((t) => !inAlbum.has(t.id));
}

export interface LocalArtist {
  name: string;
  coverUrl: string | null;
  trackCount: number;
}

/** Every distinct artist across the library, most tracks first. */
export function artists(): LocalArtist[] {
  return ensureGroups().artists;
}

function computeArtists(): LocalArtist[] {
  const byName = new Map<string, LocalArtist>();
  for (const entry of read()) {
    for (const artist of entry.track.artists) {
      const name = artist.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      const key = normName(name);
      let a = byName.get(key);
      if (!a) {
        a = { name, coverUrl: entry.track.coverUrl ?? null, trackCount: 0 };
        byName.set(key, a);
      } else if (a.name === a.name.toLowerCase() && name !== name.toLowerCase()) {
        // Rede de segurança para faixas que entraram DEPOIS da normalização:
        // uma grafia com maiúsculas ganha da que está toda em minúscula.
        a.name = name;
      }
      a.trackCount += 1;
      if (!a.coverUrl && entry.track.coverUrl) a.coverUrl = entry.track.coverUrl;
    }
  }
  return [...byName.values()].sort((x, y) => y.trackCount - x.trackCount);
}

/** All tracks credited to an artist (by name). */
export function artistTracks(name: string): TrackDto[] {
  const key = normName(name);
  return read()
    .map((e) => e.track)
    .filter((t) => t.artists.some((a) => normName(a.name) === key));
}

/** Real albums by a given artist. */
export function artistAlbums(name: string): LocalAlbum[] {
  const key = normName(name);
  return albumGroups().filter((a) => normName(a.artist) === key);
}

export interface LocalGenre {
  genre: string;
  coverUrl: string | null;
  tracks: TrackDto[];
}

/** Library tracks grouped by their (AI-assigned) genre, biggest first. */
export function genreGroups(): LocalGenre[] {
  return ensureGroups().genres;
}

function computeGenreGroups(): LocalGenre[] {
  const byKey = new Map<string, LocalGenre>();
  for (const entry of read()) {
    const g = entry.track.genre?.trim();
    if (!g) continue;
    const key = g.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { genre: g, coverUrl: entry.track.coverUrl ?? null, tracks: [] };
      byKey.set(key, group);
    }
    group.tracks.push(entry.track);
    if (!group.coverUrl && entry.track.coverUrl) group.coverUrl = entry.track.coverUrl;
  }
  return [...byKey.values()].sort((a, b) => b.tracks.length - a.tracks.length);
}

/** All library tracks of a given genre (by name, case-insensitive). */
export function genreTracks(genre: string): TrackDto[] {
  const key = genre.trim().toLowerCase();
  return read()
    .map((e) => e.track)
    .filter((t) => (t.genre ?? '').trim().toLowerCase() === key);
}

/** Object URL for a local track, or null when its audio is not available. */
export function localAudioUrl(id: string): string | null {
  return blobUrls.get(id) ?? null;
}

/** Raw bytes for a local track (for sending over P2P). */
export async function blobFor(id: string): Promise<Blob | null> {
  const url = blobUrls.get(id);
  if (url) {
    try {
      return await (await fetch(url)).blob();
    } catch {
      /* object URL revoked — fall back to cache */
    }
  }
  return getBlob(id);
}

export async function remove(id: string): Promise<void> {
  await deleteBlob(id).catch(() => undefined);
  void deleteTrackBlob(id); // best-effort remove the uploaded cross-device copy
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
  // A capa mora fora do registro: sem apagar aqui viraria lixo permanente.
  void deleteCover(id);
  const coverUrl = coverUrls.get(id);
  if (coverUrl) {
    URL.revokeObjectURL(coverUrl);
    coverUrls.delete(id);
  }
  write(read().filter((e) => e.track.id !== id));
  cloud.remove(id);
}

/** Remove several tracks at once (multi-select delete). */
export async function removeMany(ids: Iterable<string>): Promise<void> {
  for (const id of ids) await remove(id);
}

// ── de-duplication ──────────────────────────────────────────────
/** Normalized identity: the same song collapses to one key even under a
 *  slightly different title (title + primary artist + 3s duration bucket). */
function dedupeKey(track: TrackDto): string | null {
  const title = normName(track.title);
  if (!title || title === 'faixa') return null; // too generic to dedup safely
  const artist = normName(track.artists[0]?.name ?? '');
  const durBucket = Math.round((track.durationMs || 0) / 3000);
  return `${title}|${artist}|${durBucket}`;
}

export function artistaEhDesconhecido(track: TrackDto): boolean {
  return (
    track.artists.length === 0 ||
    track.artists.every((a) => !a.name?.trim() || a.name === 'Desconhecido')
  );
}

/**
 * Chave "mesma música, ignorando quem assina": título LIMPO + duração.
 *
 * Precisa do título limpo porque a cópia identificada costuma trazer o pacote
 * completo — "100% MOLHO FT. JOVEM DEX, LEVIANO E ALEE" — enquanto a anônima
 * tem só "100% MOLHO". O número de faixa na frente ("22 - SÃO PAULO") também
 * sai, pelo mesmo motivo.
 */
export function tituloDuracaoKey(track: TrackDto): string | null {
  const semNumero = track.title.replace(/^\s*\d{1,2}\s*[-–—.]\s*/, '');
  const limpo = titleSearchCandidates(semNumero)[0] ?? semNumero;
  const title = normName(limpo);
  if (!title || title === 'faixa') return null;
  const dur = track.durationMs || 0;
  if (dur <= 0) return null; // sem duração não há evidência suficiente para apagar
  return `${title}|${Math.round(dur / 3000)}`;
}

/** Which duplicate to keep: local audio > uploaded copy > has cover > older. */
function preferredEntry(a: LibraryEntry, b: LibraryEntry): LibraryEntry {
  const score = (e: LibraryEntry): number =>
    (blobUrls.has(e.track.id) ? 4 : 0) + (e.remoteUrl ? 2 : 0) + (e.track.coverUrl ? 1 : 0);
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return (a.addedAt || '') <= (b.addedAt || '') ? a : b; // older wins ties
}

/**
 * Collapse duplicate tracks (same song even under different titles) down to a
 * single copy — keeping the most complete one and deleting the rest (audio +
 * uploaded copy + synced entry). Returns how many were removed.
 */
export async function dedupeLibrary(): Promise<number> {
  const winners = new Map<string, LibraryEntry>();
  const losers: string[] = [];
  for (const e of read()) {
    const key = dedupeKey(e.track);
    if (!key) continue;
    const prev = winners.get(key);
    if (!prev) {
      winners.set(key, e);
      continue;
    }
    const keep = preferredEntry(prev, e);
    winners.set(key, keep);
    losers.push((keep === prev ? e : prev).track.id);
  }
  // ── 2ª passada: a mesma faixa que entrou duas vezes, uma SEM artista ──
  //
  // "ÚLTIMA VEZ / ALEE" e "ÚLTIMA VEZ / Desconhecido" são a mesma música, mas
  // a chave acima inclui o artista e por isso não casavam. Aqui relaxamos —
  // porém SÓ quando um dos lados é desconhecido, e exigindo título limpo e
  // duração iguais. Esta função APAGA faixas: relaxar demais custaria música
  // do usuário, o que é pior que uma lista com repetição.
  const porTituloDuracao = new Map<string, LibraryEntry>();
  for (const e of winners.values()) {
    const key = tituloDuracaoKey(e.track);
    if (!key) continue;
    const prev = porTituloDuracao.get(key);
    if (!prev) {
      porTituloDuracao.set(key, e);
      continue;
    }
    const prevAnon = artistaEhDesconhecido(prev.track);
    const curAnon = artistaEhDesconhecido(e.track);
    if (prevAnon === curAnon) continue; // ambos nomeados (podem ser covers) ou ambos anônimos
    const keep = preferredEntry(prev, e);
    porTituloDuracao.set(key, keep);
    losers.push((keep === prev ? e : prev).track.id);
  }

  if (losers.length === 0) return 0;
  const drop = new Set(losers);
  write(read().filter((e) => !drop.has(e.track.id)));
  for (const id of losers) {
    const url = blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      blobUrls.delete(id);
    }
    // SÓ o armazenamento DESTE aparelho. A cópia no importador e a entrada na
    // nuvem são compartilhadas com todos os outros, e apagá-las daqui foi um
    // estrago real: no celular o mapa `blobUrls` está vazio para tudo (lá as
    // faixas são sincronizadas, não baixadas), então duas cópias empatam em
    // `preferredEntry`, a perdedora é escolhida por idade e o telefone apagava
    // no importador o upload que o computador tinha acabado de fazer — e o
    // `cloud.remove` propagava a remoção para a conta inteira.
    //
    // A regra: quem não consegue provar que tem os bytes não destrói o que é
    // de todos. Some da lista local, e pronto.
    void deleteBlob(id).catch(() => undefined);
  }
  return losers.length;
}

export function totalBytes(): number {
  return read().reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
}

/** Advertise-able metadata for a local track (for P2P manifests). */
export function sharedMeta(id: string): SharedTrackMeta | null {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return null;
  const { track } = entry;
  return {
    id: track.id,
    title: track.title,
    artist: track.artists[0]?.name ?? 'Desconhecido',
    album: track.album?.title ?? null,
    durationMs: track.durationMs,
    sizeBytes: entry.sizeBytes,
    mimeType: entry.mimeType,
    coverDataUrl: track.coverUrl && track.coverUrl.startsWith('data:') ? track.coverUrl : null,
  };
}

let hydratePromise: Promise<void> | null = null;

/**
 * Rebuild the object-URL map from Cache Storage on boot so local tracks are
 * immediately playable. Entries without local audio are kept (they may be
 * synced from another device) — they simply aren't playable here.
 */
export function hydrate(): Promise<void> {
  return (hydratePromise ??= (async () => {
    // NÃO desistir sem Cache Storage: em http:// de LAN (o caso "abrir no
    // celular") ela não existe e os bytes ficam no IndexedDB — desistir aqui
    // deixaria toda a biblioteca importada mudinha nesses aparelhos.
    for (const entry of read()) {
      if (blobUrls.has(entry.track.id)) continue;
      const blob = await getBlob(entry.track.id).catch(() => null);
      if (blob) blobUrls.set(entry.track.id, URL.createObjectURL(blob));
    }
    await restoreEmbeddedCovers();
    normalizeArtistCasing();
    emit();
    scheduleBackgroundCuration();
  })());
}

/**
 * Reconstrói as capas embutidas a partir do IndexedDB.
 *
 * O registro guarda `coverUrl: null` para elas (a imagem não cabe no
 * localStorage), então sem este passo a faixa apareceria sem capa depois de
 * cada recarga, mesmo com a imagem salva. Só toca em quem está sem capa —
 * capa vinda do iTunes é uma URL http normal e continua valendo.
 */
async function restoreEmbeddedCovers(): Promise<void> {
  const entries = read();
  let changed = false;
  const next = await Promise.all(
    entries.map(async (entry) => {
      // Um `blob:` aqui é lixo de OUTRA sessão (ou sincronizado de outro
      // aparelho): a URL não aponta para nada. Tratar como ausente — se
      // fosse considerado "já tem capa", a faixa nunca mais recuperaria a
      // dela, mesmo com a imagem salva no IndexedDB.
      const dead = entry.track.coverUrl?.startsWith('blob:') ?? false;
      if (entry.track.coverUrl && !dead) return entry;
      const id = entry.track.id;
      const known = coverUrls.get(id);
      if (known) {
        changed = true;
        return { ...entry, track: { ...entry.track, coverUrl: known } };
      }
      const blob = await getCoverBlob(id).catch(() => null);
      if (!blob) {
        // Sem imagem guardada: limpa a URL morta para a UI mostrar o ícone
        // padrão em vez de uma imagem quebrada.
        if (!dead) return entry;
        changed = true;
        return { ...entry, track: { ...entry.track, coverUrl: null } };
      }
      const url = URL.createObjectURL(blob);
      coverUrls.set(id, url);
      changed = true;
      return { ...entry, track: { ...entry.track, coverUrl: url } };
    }),
  );
  // Só memória: o object URL é filtrado por storableEntry antes de persistir.
  if (changed) {
    cache = next;
    groupsCache = null;
  }
}

/**
 * UMA grafia por artista em toda a biblioteca.
 *
 * O agrupamento já ignora caixa/acento, então "anitta" e "Anitta" caem no mesmo
 * balde — mas cada FAIXA guarda a grafia que veio da sua fonte, e a tela mostra
 * a da faixa. O resultado é o mesmo artista aparecendo de dois jeitos em linhas
 * vizinhas, o que o usuário lê (com razão) como duplicata.
 *
 * Em vez de inventar capitalização — o que estragaria "IZA", "AC/DC",
 * "will.i.am" — elegemos entre as grafias QUE JÁ EXISTEM: a mais frequente,
 * desempatando contra a que está toda em minúscula (quase sempre metadata
 * desleixada). Só reescrevemos quando há divergência real.
 */
function normalizeArtistCasing(): void {
  const variants = new Map<string, Map<string, number>>();
  for (const entry of read()) {
    for (const artist of entry.track.artists) {
      const name = artist.name?.trim();
      if (!name) continue;
      const key = normName(name);
      if (!key) continue;
      const bucket = variants.get(key) ?? new Map<string, number>();
      bucket.set(name, (bucket.get(name) ?? 0) + 1);
      variants.set(key, bucket);
    }
  }

  const canonical = new Map<string, string>();
  for (const [key, bucket] of variants) {
    if (bucket.size < 2) continue; // grafia única: nada a decidir
    let best = '';
    let bestScore = -1;
    for (const [name, count] of bucket) {
      const allLower = name === name.toLowerCase();
      // Frequência manda; entre empatadas, a que não é toda minúscula vence.
      const score = count * 2 + (allLower ? 0 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = name;
      }
    }
    if (best) canonical.set(key, best);
  }
  if (canonical.size === 0) return;

  let changed = false;
  const next = read().map((entry) => {
    let touched = false;
    const artists = entry.track.artists.map((artist) => {
      const name = artist.name?.trim();
      const want = name ? canonical.get(normName(name)) : undefined;
      if (!want || want === artist.name) return artist;
      touched = true;
      return { ...artist, name: want };
    });
    if (!touched) return entry;
    changed = true;
    return { ...entry, track: { ...entry.track, artists } };
  });
  if (changed) write(next);
}

/**
 * Background, sequential curation (uploads + metadata healing). ALL of it hits
 * the network — offline it must not run at all (playback stays 100% local);
 * it waits for the connection to come back instead.
 */
function scheduleBackgroundCuration(): void {
  const run = (): void =>
    void (async () => {
      // CAPAS PRIMEIRO. Antes esta era a ÚLTIMA de cinco varreduras em série, e
      // a primeira delas (backfillRemote) percorre a biblioteca inteira fazendo
      // upload faixa a faixa com pausa entre elas — numa biblioteca grande, ou
      // com o importador fora do ar, a vez das capas simplesmente nunca chegava.
      // É o que o usuário VÊ na tela; vem na frente.
      // `repairMissingAudio` NÃO roda aqui — ver a própria função. Em resumo:
      // no celular toda faixa está "sem áudio local" por design, então no boot
      // ele saía baixando a biblioteca inteira para um aparelho que deveria
      // apenas transmitir. É ação manual, na página de diagnóstico.
      // CATÁLOGO: ele conserta o NOME do artista, e a busca de capa
      // logo abaixo depende do nome para achar qualquer coisa. Invertido, a
      // varredura de capas gastava as três tentativas de cada faixa anônima
      // buscando só pelo título — e as marcava como desistidas antes do
      // catálogo ter a chance de identificá-las.
      await catalogSweep().catch(() => 0);
      await backfillCovers().catch(() => undefined);
      await backfillRemote();
      await reprocessExisting();
      await dedupeLibrary().catch(() => 0); // collapse same-song duplicates
      await redriveFromSource().catch(() => false); // real metadata from the source
      await backfillCovers().catch(() => undefined); // 2ª passada: nomes já corrigidos
      await auditAttributions().catch(() => undefined); // AI spot-checks a few
    })();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    window.addEventListener('online', run, { once: true });
    return;
  }
  run();
}

/** Respiro entre itens dos passes de fundo — sem isso, centenas de iterações
 *  seguidas (stringify + renders) travavam a página em aparelhos modestos. */
const descanso = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One-time-ish backfill: upload any track that has local audio here but no
 * `remoteUrl` yet, so tracks added before cross-device sync existed become
 * playable on the user's other devices too. Sequential + best-effort; a track
 * that already has a remoteUrl (or no local audio) is skipped, so after the
 * first successful pass this does nothing.
 */
async function backfillRemote(): Promise<void> {
  for (const entry of read()) {
    if (entry.remoteUrl) continue;
    const blob = await blobFor(entry.track.id).catch(() => null);
    if (!blob) continue; // synced-in from another device — nothing to upload here
    await uploadAndLink(entry.track.id, blob);
    await descanso();
  }
}

// ── varredura de capas que faltaram ─────────────────────────────
// O enriquecimento roda UMA vez, na importação. Se ele falhou naquele instante
// — sem rede, importador fora do ar, faixa sem artista — a capa nunca mais era
// procurada e a faixa ficava cinza para sempre. Este passe é a segunda chance:
// varre quem está sem capa e tenta as três fontes, da mais confiável para a mais
// completa. É estritamente enfeite — serial, com teto, e jamais lança.

/** Espera curta antes de aceitar uma URL de capa que pode não existir. A Cover
 *  Art Archive devolve 404 para lançamento sem arte enviada, e gravar essa URL
 *  trocaria o ícone padrão por uma imagem quebrada — pior que não ter capa. */
function coverUrlLoads(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const img = new Image();
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), timeoutMs);
    img.src = url;
  });
}

/**
 * Procura a capa de UMA faixa nas três fontes, em ordem de confiança:
 * iTunes (100% de acerto no catálogo brasileiro medido, e é a única sem proxy)
 * → Deezer (cobre o que a Apple esconde por não ter preview) → MusicBrainz /
 * Cover Art Archive (fraca em sertanejo/pagode, mas é a ÚNICA que traz
 * gravadora e compositor — por isso vale a consulta mesmo com capa já achada).
 * A primeira que responder vence. Devolve true quando a faixa saiu sem capa.
 */
/**
 * Miniatura de um link do YouTube. `maxresdefault` nem sempre existe; o
 * `hqdefault` existe SEMPRE, então ele é o alvo — capa garantida vale mais que
 * capa grande que às vezes some.
 */
export function youtubeThumbFor(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, '');
    const id =
      host === 'youtu.be'
        ? url.pathname.slice(1)
        : /(^|\.)youtube\.com$/.test(host)
          ? url.searchParams.get('v')
          : null;
    return id && /^[\w-]{6,}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

/**
 * Artista provável de uma faixa órfã, deduzido das irmãs.
 *
 * Preferimos as do MESMO álbum; sem álbum, as importadas na MESMA janela de
 * tempo (mesmo lote de arquivos). Só devolve quando há maioria clara — um
 * palpite dividido é pior que nenhum, porque contamina a busca.
 */
export function guessArtistFromSiblings(
  entry: LibraryEntry,
  all: readonly LibraryEntry[] = read(),
): string | null {
  const albumKeyOf = entry.track.album?.title?.trim().toLowerCase();
  const addedAt = new Date(entry.addedAt).getTime();
  const JANELA_MS = 5 * 60_000; // mesmo lote de import

  const siblings = all.filter((e) => {
    if (e.track.id === entry.track.id) return false;
    const name = e.track.artists[0]?.name;
    if (!name || name === 'Desconhecido') return false;
    if (albumKeyOf) return e.track.album?.title?.trim().toLowerCase() === albumKeyOf;
    const t = new Date(e.addedAt).getTime();
    return Number.isFinite(t) && Math.abs(t - addedAt) <= JANELA_MS;
  });
  if (siblings.length === 0) return null;

  const tally = new Map<string, number>();
  for (const s of siblings) {
    const name = s.track.artists[0]?.name as string;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (!best) return null;
  // Maioria clara: mais da metade das irmãs concordam.
  return best[1] * 2 > siblings.length ? best[0] : null;
}

async function healCoverFor(id: string): Promise<boolean> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return true; // removida no meio do passe — não é mais pendência
  const { track } = entry;
  const artist =
    track.artists.map((a) => a.name).filter((n) => n && n !== 'Desconhecido')[0] ??
    // Faixa sem artista buscada só pelo título traz qualquer coisa ("CAROLINA"
    // devolveu Sweet Caroline). Mas ela quase nunca chega sozinha: veio num
    // lote, junto de irmãs que FORAM identificadas. O artista dominante do
    // álbum/lote é um palpite muito melhor que nenhum.
    guessArtistFromSiblings(entry) ??
    '';

  let cover: string | null = null;
  /** Identidade CONFIRMADA por um catálogo — conserta "Desconhecido". */
  let confirmed: { title: string; artist: string; album: string | null } | null = null;

  // Títulos de trap/rap vêm com participante e produtor grudados
  // ("TUDO BEM FT. BNYX"); o catálogo cadastra só "TUDO BEM".
  const titles = titleSearchCandidates(track.title);

  // ORDEM MEDIDA, não suposta. Num acervo de trap/rap nacional independente
  // (Brandão85 etc.) o iTunes simplesmente NÃO TEM o catálogo: 0 de 4 faixas
  // testadas. O Deezer achou 3 de 4, com capa em alta. O benchmark que dava
  // 100% ao iTunes usava artistas mainstream — não é a biblioteca real deste
  // usuário. Por isso o Deezer vem primeiro; o iTunes continua logo atrás
  // porque é direto do navegador e funciona mesmo com o importador fora do ar.
  for (const title of titles) {
    const hit = await fetchCover(title, artist).catch(() => null);
    if (!hit?.coverUrl) continue;
    // CONFERIR o que o importador escolheu. Sem isto entrava capa errada:
    // buscar "Brandao85 CAROLINA" no Deezer devolve "Sweet Caroline" da "Dani
    // Brandão" como PRIMEIRO resultado. Capa errada é pior que capa nenhuma —
    // ela mente com confiança e o usuário não tem como saber.
    const score = scoreArtworkMatch(
      { title: hit.title ?? '', artist: hit.artist ?? '', artworkUrl: hit.coverUrl },
      title,
      artist || null,
    );
    if (score === 0) continue;
    cover = hit.coverUrl;
    if (hit.title && hit.artist) {
      confirmed = { title: hit.title, artist: hit.artist, album: hit.album };
    }
    break;
  }

  // 2. iTunes — busca SEM exigir preview (ver searchSongsForArtwork).
  if (!cover) {
    for (const title of titles) {
      const term = [artist, title].filter(Boolean).join(' ');
      const rows = await searchSongsForArtwork(term, 'br', 10).catch(() => []);
      const hit = pickArtworkMatch(
        rows.map((r) => ({
          title: r.trackName,
          artist: r.artistName,
          artworkUrl: r.artworkUrl100,
          collection: r.collectionName,
        })),
        title,
        artist,
      );
      if (!hit) continue;
      cover = appleArtwork(hit.artworkUrl, 'grid');
      confirmed = { title: hit.title, artist: hit.artist, album: hit.collection ?? null };
      break;
    }
  }

  // 3. MusicBrainz: capa de último recurso E a ficha técnica que só ela tem.
  const wantCredits = isMissingCredits(track);
  const credits =
    !cover || wantCredits ? await fetchCredits(track.title, artist).catch(() => null) : null;
  if (!cover && credits?.coverUrl && (await coverUrlLoads(credits.coverUrl))) {
    cover = credits.coverUrl;
  }

  // 4. Último recurso: a miniatura da FONTE (YouTube etc.).
  //
  // Não é arte de álbum — é um quadro de vídeo 16:9, e por isso ficou fora da
  // ordem principal. Mas quando nenhum catálogo tem a faixa (rap independente,
  // remix, gravação caseira), a escolha real não é "capa boa ou capa torta": é
  // "alguma capa ou um ícone de nota musical". A imagem é cortada em quadrado
  // no CSS (object-cover), então o resultado é o miolo do frame — quase sempre
  // a arte que o próprio artista pôs no vídeo.
  if (!cover && entry.sourceUrl) {
    const thumb = youtubeThumbFor(entry.sourceUrl);
    if (thumb && (await coverUrlLoads(thumb))) cover = thumb;
  }

  const cur = read().find((e) => e.track.id === id);
  if (!cur) return true;
  const nextCover = cover ? safeCoverUrl(cover) : null;
  const label = cur.track.label ?? credits?.label ?? null;
  const composer = cur.track.composer ?? credits?.composer ?? null;

  // A identidade veio de tabela: se o catálogo confirmou a faixa (título E
  // artista casaram no scoreArtworkMatch), ele sabe o nome certo melhor que o
  // nome do arquivo. É o que tira o "Desconhecido" e o TÍTULO EM CAIXA ALTA
  // com "FT. FULANO" pendurado. Só sobrescreve o artista quando ele é
  // desconhecido — nunca troca um crédito que o usuário já tem por outro.
  const artistaDesconhecido =
    cur.track.artists.length === 0 ||
    cur.track.artists.every((a) => !a.name || a.name === 'Desconhecido');
  const artists =
    confirmed && artistaDesconhecido
      ? [{ id: `local-artist:${id}:0`, name: confirmed.artist, slug: '', imageUrl: null }]
      : cur.track.artists;
  const title = confirmed && artistaDesconhecido ? confirmed.title : cur.track.title;
  const album =
    confirmed?.album && !cur.track.album
      ? { id: `local-album:${id}`, title: confirmed.album, slug: '', coverUrl: null }
      : cur.track.album;

  const changed =
    Boolean(nextCover) ||
    label !== cur.track.label ||
    composer !== cur.track.composer ||
    artists !== cur.track.artists ||
    title !== cur.track.title ||
    album !== cur.track.album;
  if (changed) {
    const coverFinal = nextCover ?? cur.track.coverUrl;
    patchEntry(id, {
      ...cur,
      track: {
        ...cur.track,
        title,
        artists,
        coverUrl: coverFinal,
        // O álbum carrega a própria capa (é ela que a grade de álbuns mostra) —
        // atualizar só a faixa deixaria o álbum cinza ao lado da faixa colorida.
        album: album ? { ...album, coverUrl: coverFinal } : album,
        label,
        composer,
      },
    });
  }
  return Boolean(nextCover);
}

/** Quantos artistas da biblioteca viram catálogo por varredura. Cada um custa
 *  dezenas de chamadas no importador; os mais representados resolvem a maioria
 *  e o resto continua na varredura seguinte. */
const CATALOG_ARTIST_LIMIT = 12;

/** Quantas faixas órfãs consultam a fonte por varredura. Uma chamada leve cada,
 *  mas um acervo grande tem centenas — e um lote costuma ser todo do mesmo
 *  artista, então as primeiras já revelam o nome que destrava o resto. */
const SOURCE_LOOKUP_LIMIT = 40;

/**
 * Identificação em LOTE pelo catálogo do artista — a varredura que conserta as
 * faixas que a busca faixa-a-faixa nunca ia consertar.
 *
 * O acervo veio do YouTube em lotes por artista e chegou sem metadado: título
 * em caixa alta, artista "Desconhecido", nenhuma capa. Buscar cada uma pelo
 * título é loteria — "CAROLINA" devolve o Ninho, "CEO" devolve o SCH. Aqui a
 * pergunta é outra: baixa o catálogo inteiro de quem JÁ está creditado na
 * biblioteca e confere se a órfã mora lá dentro, casando título E duração.
 * Medido no acervo real: 52 de 55 identificadas, contra 29 pela busca solta.
 *
 * Roda antes das capas porque conserta o NOME — e a busca de capa que vem
 * depois passa a ter artista para trabalhar nas que sobraram.
 */
async function catalogSweep(): Promise<number> {
  const offline = (): boolean => typeof navigator !== 'undefined' && !navigator.onLine;
  if (offline()) return 0;

  const pendente = (t: TrackDto): boolean => isMissingCover(t) || artistaEhDesconhecido(t);
  if (!read().some((e) => pendente(e.track))) return 0;

  let curadas = 0;
  const jaVistos = new Set<string>();

  /** Baixa o catálogo de um artista e cura tudo que casar. */
  const rodar = async (nomes: readonly string[]): Promise<void> => {
    for (const nome of nomes) {
      if (offline()) return;
      const chave = normalizeForMatch(nome);
      if (!chave || jaVistos.has(chave)) continue;
      jaVistos.add(chave);
      const alvos = read().filter((e) => pendente(e.track));
      if (!alvos.length) return; // acabou a pendência — não gasta o resto
      curadas += await curarCom(nome, alvos);
    }
  };

  // 1ª rodada: quem já está creditado na biblioteca. As órfãs quase sempre
  // vieram no mesmo lote que as identificadas, então isto resolve a maioria.
  await rodar(candidateArtists(read().map((e) => e.track)).slice(0, CATALOG_ARTIST_LIMIT));

  // 2ª rodada: PERGUNTA À FONTE quem é o artista das que sobraram.
  //
  // Sem este passo, um lote inteiro de um artista que ninguém credita fica
  // invisível — foi o que deixou 11 faixas do Matuê sem correspondência mesmo
  // com o catálogo tendo todas elas. Tentei antes deduzir o dono buscando o
  // título e conferindo a duração (1 acerto em 14: títulos como "PARTY" e
  // "BACKSTAGE" afundam a faixa certa) e ranquear os parceiros dos artistas
  // conhecidos (também 1 em 14: quem mais aparece é produtor). O vídeo de
  // origem simplesmente DIZ o artista — é dado, não inferência.
  const sobraram = read().filter((e) => pendente(e.track) && e.sourceUrl);
  if (sobraram.length && !offline()) {
    const daFonte = new Map<string, { name: string; n: number }>();
    for (const e of sobraram.slice(0, SOURCE_LOOKUP_LIMIT)) {
      if (offline()) break;
      const nome = await artistFromSource(e.sourceUrl as string).catch(() => null);
      if (!nome) continue;
      const key = normalizeForMatch(nome);
      if (!key || jaVistos.has(key)) continue;
      const prev = daFonte.get(key);
      if (prev) prev.n += 1;
      else daFonte.set(key, { name: nome, n: 1 });
    }
    // Quem explica mais órfãs primeiro: um lote grande do mesmo artista se
    // resolve numa consulta de catálogo só.
    await rodar([...daFonte.values()].sort((a, b) => b.n - a.n).map((v) => v.name));
  }
  return curadas;
}

/** Cura as faixas pendentes que casarem no catálogo deste artista. */
async function curarCom(nome: string, alvos: readonly LibraryEntry[]): Promise<number> {
  let curadas = 0;

  // Apple primeiro: é direto do navegador, então funciona mesmo com o
  // importador caseiro desligado ou desatualizado — que foi exatamente o
  // estado em que a varredura devolveu "sem correspondência" para tudo.
  // A Deezer (via importador) entra só como reforço, para o que a Apple não
  // tiver; as duas juntas cobrem mais que qualquer uma sozinha.
  let catalogo = await fetchAppleCatalog(nome).catch(() => []);
  if (!catalogo.length) catalogo = await fetchArtistCatalog(nome).catch(() => []);
  if (!catalogo.length) return 0;
  const index = indexCatalog(catalogo);
  {
    for (const entry of alvos) {
      const hit = matchInCatalog(entry.track, index);
      if (!hit) continue;

      // Faixa JÁ creditada só aceita capa do catálogo do PRÓPRIO artista. Sem
      // esta trava, uma faixa do Brandão85 com título xará casaria no catálogo
      // do Matuê e receberia a capa errada — o defeito que estamos consertando.
      const anonima = artistaEhDesconhecido(entry.track);
      if (
        !anonima &&
        normalizeForMatch(entry.track.artists[0]?.name ?? '') !== normalizeForMatch(hit.artist)
      ) {
        continue;
      }

      const cur = read().find((e) => e.track.id === entry.track.id);
      if (!cur) continue;
      const capa = hit.cover ? safeCoverUrl(hit.cover) : null;
      const coverFinal = capa ?? cur.track.coverUrl;
      const artists = anonima
        ? [
            {
              id: `local-artist:${cur.track.id}:0`,
              name: hit.artist,
              slug: '',
              imageUrl: null,
            },
          ]
        : cur.track.artists;
      // O título do catálogo é o registrado; o do acervo veio do nome do vídeo.
      // Só troca quando a faixa era anônima — nunca renomeia o que o usuário
      // já tem identificado.
      const title = anonima ? hit.title : cur.track.title;
      const album =
        hit.album && !cur.track.album
          ? { id: `local-album:${cur.track.id}`, title: hit.album, slug: '', coverUrl: coverFinal }
          : cur.track.album;

      patchEntry(cur.track.id, {
        ...cur,
        track: {
          ...cur.track,
          title,
          artists,
          coverUrl: coverFinal,
          album: album ? { ...album, coverUrl: coverFinal } : album,
        },
      });
      curadas += 1;
    }
  }
  await descanso(400); // gentil com a fonte entre catálogos
  return curadas;
}

/** "Identificar pelo catálogo": roda o passe agora, sob demanda. */
export function runCatalogSweep(): Promise<number> {
  return catalogSweep().catch(() => 0);
}

/**
 * O passe: uma faixa por vez, com respiro, teto por sessão e memória de
 * tentativas entre sessões (ver coverBackfill.ts). Offline ele nem começa — o
 * agendador já espera a conexão voltar — e reconfere a cada faixa, porque a
 * rede pode cair no meio de uma varredura de 30.
 */
async function backfillCovers(): Promise<void> {
  const offline = (): boolean => typeof navigator !== 'undefined' && !navigator.onLine;
  if (offline()) return;
  const attempts = readCoverAttempts();
  const todo = pickBackfillCandidates(
    read().map((e) => e.track),
    attempts,
  );
  for (const track of todo) {
    if (offline()) return; // o que sobrou continua pendente para a próxima sessão
    const found = await healCoverFor(track.id).catch(() => false);
    bumpCoverAttempt(track.id, found);
    await descanso(400); // gentil com iTunes/Deezer/MusicBrainz
  }
}

/** Quantas faixas a varredura ainda pretende tentar (linha "buscando capas…"). */
export function pendingCoverCount(): number {
  return countPendingCovers(
    read().map((e) => e.track),
    readCoverAttempts(),
  );
}

/** "Tentar de novo": zera as desistidas e roda a varredura já.
 *
 *  Passa pelo catálogo antes das capas pelo mesmo motivo da curadoria de
 *  fundo — é ele que devolve o NOME do artista, e sem nome a busca de capa
 *  das faixas anônimas não tem por onde começar. Este é o botão que o usuário
 *  aperta quando a tela está errada; ele precisa rodar o conserto inteiro. */
export function retryCoverBackfill(): void {
  resetCoverAttempts();
  void (async () => {
    await catalogSweep().catch(() => 0);
    await backfillCovers().catch(() => undefined);
  })();
}

// ── one-time reprocess of pre-existing tracks ───────────────────
// Tracks added before the accuracy/multi-artist work can have a wrong cover,
// a wrong name, or two collaborating artists merged into one (which also breaks
// lyrics lookup). Bump REPROCESS_VERSION to re-run this pass for everyone.
const REPROCESS_KEY = 'aurial:reprocessVersion';
// v6: TIME DE METADADOS completo — a FONTE é a autoridade. Re-deriva TODAS as
// faixas da fonte (cura créditos alucinados, ex. "Warzone" do Brandão85 →
// The Wanted) com a lente de álbum (Deezer) e re-audita tudo. v6 re-arma a
// cura da v5, que podia rodar contra um importer ANTIGO sem uploader/álbum e
// "concluir" sem curar nada — agora o passe exige as capacidades novas.
const REPROCESS_VERSION = 6;

// ── periodic AI audit of attributions ───────────────────────────
// iTunes has the final word on who a song is by; the AI just periodically
// checks a few tracks and, if it flags a likely mismatch, we re-run the iTunes
// verification (which decides). Audited ids live in a local set (not synced).
const AUDITED_KEY = 'aurial:auditedArtists';

function readAudited(): Set<string> {
  try {
    const raw = window.localStorage.getItem(AUDITED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function markAudited(ids: string[]): void {
  try {
    const s = readAudited();
    for (const id of ids) s.add(id);
    window.localStorage.setItem(AUDITED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Strip a credit we KNOW is wrong: better "Desconhecido" than the wrong name
 *  (the wrong artist photo disappears with it — photos are looked up by name). */
function clearWrongCredit(id: string): void {
  const cur = read().find((e) => e.track.id === id);
  if (!cur) return;
  const track: TrackDto = {
    ...cur.track,
    artists: [{ id: `local-artist:${id}:0`, name: 'Desconhecido', slug: '', imageUrl: null }],
    genre: null, // the genre came from the same wrong match
  };
  patchEntry(id, { ...cur, track });
}

/** AUDITOR: audit up to `limit` not-yet-checked attributed tracks per run
 *  (spreads the cost over sessions). A IA só LEVANTA a suspeita (nunca decide):
 *  num "NÃO" claro, tenta (1) confirmar no catálogo, (2) re-derivar da FONTE
 *  (uploader/metadados reais) e, só se nada provar um crédito, apaga o errado —
 *  melhor "Desconhecido" que um artista alucinado. */
async function auditAttributions(limit = 12): Promise<void> {
  const audited = readAudited();
  const todo = read()
    .filter((e) => {
      const a = e.track.artists[0]?.name;
      return a && a !== 'Desconhecido' && !audited.has(e.track.id);
    })
    .slice(0, limit);
  if (todo.length === 0) return;
  // Sem o importer novo a cura pela fonte não existe — não apaga crédito nenhum
  // ainda (senão viraria "Desconhecido" o que a fonte poderia provar depois).
  if (!(await helperSupportsMetaTeam())) return;
  const done: string[] = [];
  for (const e of todo) {
    const verdict = await aiVerifyArtist(
      e.track.title,
      e.track.artists.map((a) => a.name).join(', '),
    ).catch(() => null);
    if (verdict === false) {
      const confirmed = await enrichLocalTrack(e.track.id).catch(() => false);
      if (!confirmed) {
        const result = await rederiveTrackFromSource(e.track.id).catch(() => 'failed' as const);
        // Importador fora do ar → NÃO apaga o crédito (a fonte poderia prová-lo
        // depois) e não marca como auditada — re-tenta noutra sessão.
        if (result === 'failed') continue;
        if (result === 'unchanged') clearWrongCredit(e.track.id);
      }
    }
    done.push(e.track.id);
    await descanso();
  }
  if (done.length > 0) markAudited(done);
}

// ── re-identify existing tracks from their SOURCE metadata (yt-dlp) ──────────
const REDERIVE_KEY = 'aurial:rederivedSet';

function readRederived(): Set<string> {
  try {
    const raw = window.localStorage.getItem(REDERIVE_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function markRederived(ids: string[]): void {
  try {
    const s = readRederived();
    for (const id of ids) s.add(id);
    window.localStorage.setItem(REDERIVE_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * AUDITOR (metaTeam): re-deriva UMA faixa da sua fonte. Busca os metadados
 * reais (yt-dlp, incluindo o canal do uploader), o JUIZ decide o crédito por
 * precedência de evidência e, quando o crédito antigo CONFLITA com a fonte
 * (crédito alucinado por catálogo/IA — ex. "Warzone" → The Wanted), descarta
 * também a capa/álbum/gênero herdados do match errado, voltando à capa da
 * fonte. Resultado distingue FALHA (importador indisponível — tentar depois)
 * de "nada novo" (a fonte concorda com o que já temos) e de "atualizado".
 */
type RederiveResult = 'failed' | 'unchanged' | 'updated';

async function rederiveTrackFromSource(id: string): Promise<RederiveResult> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry?.sourceUrl || importerHostLabel(hostOf(entry.sourceUrl)) === null) return 'unchanged';
  const meta = await fetchTrackMeta(entry.sourceUrl).catch(() => null);
  if (!meta) return 'failed';
  const cur = read().find((x) => x.track.id === id);
  if (!cur) return 'unchanged';

  const ev = extrator({
    artist: meta.artist,
    track: meta.track,
    album: meta.album,
    uploader: meta.uploader,
    title: meta.title,
  });
  const atual = cur.track.artists[0]?.name ?? null;
  const conflito = juizCreditoConflita(ev, atual);
  const credito = juizDecideCredito(ev, { artist: conflito ? null : atual });
  // VERIFICADOR — lente de álbum: se a fonte cita um álbum real, o artista e a
  // capa autoritativos vêm dele (prova dupla: título do álbum + faixa na
  // tracklist). É o que devolve o "Nadando Cem Os Tubarões" ao Charlie Brown Jr.
  const albumVer = await verificadorAlbum(ev).catch(() => null);

  const artistFinal = albumVer?.artist ?? credito.artist;
  const sameArtist = artistFinal === (atual ?? 'Desconhecido');
  const sameTitle = credito.title === cur.track.title;
  if (!conflito && !albumVer && sameArtist && sameTitle && !credito.album) return 'unchanged';

  const base = localTrackDto(
    id,
    credito.title || cur.track.title,
    artistFinal,
    cur.track.durationMs,
    albumVer?.album ?? credito.album ?? (conflito ? null : (cur.track.album?.title ?? null)),
    // Capa herdada de um match alucinado sai junto com o crédito errado; a capa
    // real do álbum (lente) tem prioridade sobre o thumbnail da fonte.
    albumVer?.coverUrl ?? (conflito ? (safeCoverUrl(meta.thumbnail) ?? null) : cur.track.coverUrl),
  );
  const track: TrackDto = {
    ...base,
    genre: conflito ? null : (cur.track.genre ?? null),
    streamUrl: cur.remoteUrl ?? cur.track.streamUrl,
  };
  patchEntry(id, { ...cur, track });
  // VERIFICADOR: com o crédito agora provado, o iTunes pode refinar capa/gênero
  // (só aplica quando título E artista batem — underground fica como está).
  await enrichLocalTrack(id).catch(() => undefined);
  if (cur.sourceUrl) {
    const healed = read().find((x) => x.track.id === id);
    if (healed) void publishSharedTrack(healed.track, cur.sourceUrl);
  }
  return 'updated';
}

/**
 * AUDITOR: varre faixas ainda não re-derivadas da fonte, algumas por sessão
 * (gentil com o YouTube). Cada faixa passa pelo pipeline completo do time —
 * EXTRATOR → CURADOR → JUIZ → VERIFICADOR. Falhas não são marcadas (a faixa
 * tenta de novo na próxima sessão) e 3 falhas SEGUIDAS abortam a varredura —
 * um importador com problema não vira uma enxurrada de erros no console.
 * Retorna true quando o lote terminou sem abortar.
 */
async function redriveFromSource(limit = 6): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const done = readRederived();
  const todo = read()
    .filter(
      (e) =>
        e.sourceUrl && !done.has(e.track.id) && importerHostLabel(hostOf(e.sourceUrl)) !== null,
    )
    .slice(0, limit);
  if (todo.length === 0) return true;
  // Um importer ANTIGO (sem uploader/álbum) responderia sem as evidências e a
  // faixa seria marcada como "re-derivada" sem cura — só roda com o novo.
  if (!(await helperSupportsMetaTeam())) return false;
  const marked: string[] = [];
  let consecutiveFailures = 0;
  let aborted = false;
  for (const e of todo) {
    const result = await rederiveTrackFromSource(e.track.id).catch(() => 'failed' as const);
    if (result === 'failed') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        aborted = true;
        break;
      }
      continue; // não marca — tenta de novo quando o importador estiver saudável
    }
    consecutiveFailures = 0;
    marked.push(e.track.id);
    await descanso();
  }
  if (marked.length > 0) markRederived(marked);
  return !aborted;
}

/** Split a single merged artist credit on an existing track (when enrichment couldn't). */
async function resplitArtistsInPlace(id: string): Promise<void> {
  const cur = read().find((e) => e.track.id === id);
  if (!cur || cur.track.artists.length > 1) return; // already split
  const combined = cur.track.artists[0]?.name?.trim();
  if (!combined || combined === 'Desconhecido') return;
  let names = splitArtistNames(combined);
  if (names.length <= 1 && creditIsAmbiguous(combined)) {
    const ai = await aiSplitArtists(combined, cur.track.title);
    if (ai && ai.length > 1) names = ai;
  }
  if (names.length <= 1) return; // genuinely a single artist
  const track = localTrackDto(
    id,
    cur.track.title,
    names,
    cur.track.durationMs,
    cur.track.album?.title ?? null,
    cur.track.coverUrl,
  );
  patchEntry(id, { ...cur, track: { ...track, streamUrl: cur.remoteUrl ?? cur.track.streamUrl } });
}

/**
 * Re-run enrichment (correct cover/name + split artists) once over every local
 * track. Enrichment only applies a confident match, so it never worsens good
 * data; when it can't confirm, we still split a merged artist credit in place.
 */
async function reprocessExisting(): Promise<void> {
  try {
    if (Number(window.localStorage.getItem(REPROCESS_KEY) || '0') >= REPROCESS_VERSION) return;
  } catch {
    return;
  }
  // A cura depende do importer NOVO (uploader + lente de álbum). Sem ele no ar,
  // NÃO marca a versão — tenta de novo no próximo boot, em vez de "concluir"
  // uma cura que não aconteceu (foi o que a v5 fazia contra o importer antigo).
  if (!(await helperSupportsMetaTeam())) return;

  // 1. AUDITOR: a fonte primeiro — re-deriva TODAS as faixas (zera o controle
  //    para incluir as que a v<6 marcou como feitas com o crédito errado).
  try {
    window.localStorage.removeItem(REDERIVE_KEY);
    window.localStorage.removeItem(AUDITED_KEY);
  } catch {
    /* ignore */
  }
  const completed = await redriveFromSource(Number.POSITIVE_INFINITY).catch(() => false);
  // Importador instável no meio do passe → NÃO grava a versão; o que faltou
  // re-tenta na próxima sessão (as re-derivadas com sucesso ficam marcadas).
  if (!completed) return;

  // 2. VERIFICADOR: refina capa/nome no catálogo (só matches estritos) e
  //    separa créditos de colaboração ainda fundidos num nome só.
  for (const entry of read()) {
    if (!entry.track.id.startsWith('local:')) continue;
    const applied = await enrichLocalTrack(entry.track.id).catch(() => false);
    if (!applied) await resplitArtistsInPlace(entry.track.id).catch(() => undefined);
    await descanso();
  }

  // 3. AUDITOR (IA): re-audita todos os créditos com o pipeline de cura novo.
  await auditAttributions(Number.POSITIVE_INFINITY).catch(() => undefined);
  try {
    window.localStorage.setItem(REPROCESS_KEY, String(REPROCESS_VERSION));
  } catch {
    /* ignore */
  }
}
