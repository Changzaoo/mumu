/**
 * Local likes — the user's "Curtidas", kept entirely on-device in localStorage.
 * Mirrors localPlaylists: an ordered id list (newest-first) plus a companion
 * Record<id, TrackDto> so the Curtidas page renders and plays without a backend.
 */
import type { TrackDto } from '@aurial/shared';
import { serverCollection } from '@/lib/sync/serverCollection';
import { gravarLocal } from '@/lib/local/cofreLocal';

const LIKES_KEY = 'aurial:local-likes'; // string[] of track ids, newest-first
const TRACKS_KEY = 'aurial:local-liked-tracks'; // Record<trackId, TrackDto>

interface LikeDoc {
  track: TrackDto;
  likedAt: string;
}

let idsCache: string[] | null = null;
let tracksCache: Record<string, TrackDto> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readIds(): string[] {
  if (idsCache) return idsCache;
  try {
    const raw = window.localStorage.getItem(LIKES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    idsCache = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    idsCache = [];
  }
  return idsCache;
}

function readTracks(): Record<string, TrackDto> {
  if (tracksCache) return tracksCache;
  try {
    const raw = window.localStorage.getItem(TRACKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    tracksCache = parsed && typeof parsed === 'object' ? (parsed as Record<string, TrackDto>) : {};
  } catch {
    tracksCache = {};
  }
  return tracksCache;
}

// O que o usuário curtiu é escolha dele, não cache: sob pressão de cota abre
// espaço sacrificando enfeite. Ver lib/local/cofreLocal.ts.
function writeIds(next: string[]): void {
  idsCache = next;
  gravarLocal(LIKES_KEY, JSON.stringify(next));
  emit();
}

function writeTracks(next: Record<string, TrackDto>): void {
  tracksCache = next;
  gravarLocal(TRACKS_KEY, JSON.stringify(next));
}

export function has(id: string): boolean {
  return readIds().includes(id);
}

/** Liked tracks, newest-first (skips any whose DTO was lost). */
export function list(): TrackDto[] {
  const map = readTracks();
  return readIds()
    .map((id) => map[id])
    .filter((t): t is TrackDto => t !== undefined);
}

// Local-only appliers (used by the cloud sync — must not re-push).
function applyAdd(track: TrackDto): void {
  const ids = readIds();
  if (ids.includes(track.id)) return;
  writeTracks({ ...readTracks(), [track.id]: track });
  writeIds([track.id, ...ids]);
}

function applyRemove(id: string): void {
  const ids = readIds();
  if (!ids.includes(id)) return;
  writeIds(ids.filter((tid) => tid !== id));
  // The companion DTO is left in the map; it's tiny and harmless.
}

// A SINCRONIA SAIU DO FIRESTORE (ver lib/sync/serverCollection.ts).
// Motivo: o primeiro snapshot de cada sessão trazia a coleção INTEIRA, cobrada
// por documento, e o limite grátis é do PROJETO — quando estourava, caíam
// juntos acervo, sincronia e curtidas. Aconteceu três vezes.
// Ganho de quebra: a escrita entra numa FILA EM DISCO antes de tentar a rede,
// então curtir com o servidor fora do ar funciona e sobe sozinho depois.
const cloud = serverCollection<LikeDoc>({
  name: 'likes',
  localItems: () => {
    const map = readTracks();
    return readIds()
      .filter((id) => map[id])
      .map((id): [string, LikeDoc] => [
        id,
        { track: map[id] as TrackDto, likedAt: new Date().toISOString() },
      ]);
  },
  onRemoteUpsert: (_id, data) => applyAdd(data.track),
  onRemoteDelete: (id) => applyRemove(id),
});

/** Start/stop cross-device sync (called on auth change). */
export const setUser = cloud.setUser;

export function add(track: TrackDto): void {
  applyAdd(track);
  cloud.push(track.id, { track, likedAt: new Date().toISOString() });
}

export function remove(id: string): void {
  applyRemove(id);
  cloud.remove(id);
}

export function toggle(track: TrackDto, liked: boolean): void {
  if (liked) add(track);
  else remove(track.id);
}

export function count(): number {
  return readIds().length;
}

/**
 * Curtir uma faixa do catálogo continua valendo (é sinal de gosto e alimenta a
 * recomendação) — o que não pode é ela virar acervo. Esta limpeza remove só o
 * que ficou de trás: prévias de 30s, que nunca foram músicas de verdade.
 */
export function purgePreviews(): number {
  const map = readTracks();
  const bad = readIds().filter((id) => map[id]?.previewOnly);
  if (bad.length === 0) return 0;
  const badSet = new Set(bad);
  writeIds(readIds().filter((id) => !badSet.has(id)));
  const nextMap = { ...map };
  for (const id of bad) delete nextMap[id];
  writeTracks(nextMap);
  for (const id of bad) cloud.remove(id);
  emit();
  return bad.length;
}
