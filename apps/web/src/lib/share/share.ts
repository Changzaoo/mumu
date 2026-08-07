/**
 * Compartilhamento por link (Spotify-style): música/álbum/artista/mix viram um
 * doc PÚBLICO em `shares/{id}` no Firestore; quem recebe o link abre /s/:id e
 * cai direto no conteúdo — logado ouve completo (stream via importer), sem
 * login ouve prévias de 30s e é convidado a registrar.
 */
import { firestore } from '@/lib/sync/firestoreLazy';
import type { User } from 'firebase/auth';
import type { TrackDto } from '@aurial/shared';
import { db, subscribeAuth } from '@/lib/firebase';
import { remoteUrlFor, sourceUrlFor } from '@/lib/local/localLibrary';
import { trackArtistNames } from '@/lib/utils';

export type ShareType = 'música' | 'álbum' | 'artista' | 'mix';

export interface ShareTrack {
  title: string;
  artist: string;
  coverUrl: string | null;
  durationMs: number;
  /** Link original — permite o stream completo para quem tem conta. */
  sourceUrl: string | null;
  /**
   * A CÓPIA NO COFRE — é ela que faz quem abre o link ouvir a música INTEIRA.
   *
   * Antes, visitante sem conta ouvia 30 segundos: o stream completo saía de
   * `buildStreamUrl`, que assina com o token do Firebase de QUEM ESTÁ OUVINDO —
   * e visitante não tem token. A prévia não era uma escolha de produto, era o
   * único caminho que sobrava.
   *
   * Esta URL já vem assinada por QUEM COMPARTILHOU, no momento de compartilhar,
   * e por isso vale para qualquer um que abra o link — sem conta, sem login.
   *
   * Consequência, e ela é deliberada: quem tiver o link ou o QR ouve a faixa
   * inteira. Link se encaminha e se fotografa; não há como recolher um que já
   * saiu. Foi pedido assim.
   */
  remoteUrl?: string | null;
}

export interface SharePayload {
  type: ShareType;
  title: string;
  subtitle: string;
  coverUrl: string | null;
  tracks: ShareTrack[];
}

export interface ShareDoc extends SharePayload {
  byUid: string;
  byName: string | null;
  createdAt: string;
}

const INLINE_PREFIX = 'inline~';

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded = value + '='.repeat((4 - (value.length % 4 || 4)) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function asInlineShare(payload: SharePayload): string {
  const doc: ShareDoc = {
    ...payload,
    byUid: currentUser?.uid ?? 'public',
    byName: currentUser?.displayName ?? null,
    createdAt: new Date().toISOString(),
  };
  const token = base64UrlEncode(JSON.stringify(doc));
  return `${window.location.origin}/s/${INLINE_PREFIX}${token}`;
}

let currentUser: User | null = null;
subscribeAuth((user) => {
  currentUser = user;
});

/** TrackDto[] → faixas compartilháveis (com o link original de cada uma). */
export function tracksToShare(tracks: TrackDto[]): ShareTrack[] {
  return tracks.map((t) => ({
    title: t.title,
    artist: trackArtistNames(t),
    coverUrl: t.coverUrl,
    durationMs: t.durationMs,
    sourceUrl: sourceUrlFor(t.id),
    // Vai assinada por quem compartilha — ver o comentário de `remoteUrl`.
    remoteUrl: remoteUrlFor(t.id) ?? t.streamUrl ?? null,
  }));
}

/** Cria o doc público e devolve a URL compartilhável (null sem login/Firestore). */
export async function createShare(payload: SharePayload): Promise<string | null> {
  if (!db || !currentUser) return asInlineShare(payload);
  try {
    const { addDoc, collection } = await firestore();
    const docRef = await addDoc(collection(db, 'shares'), {
      ...payload,
      tracks: payload.tracks.slice(0, 50),
      byUid: currentUser.uid,
      byName: currentUser.displayName ?? null,
      createdAt: new Date().toISOString(),
    } satisfies ShareDoc);
    return `${window.location.origin}/s/${docRef.id}`;
  } catch {
    return asInlineShare(payload);
  }
}

/** Carrega um compartilhamento público pelo id do link. */
export async function fetchShare(id: string): Promise<ShareDoc | null> {
  if (id.startsWith(INLINE_PREFIX)) {
    const raw = base64UrlDecode(id.slice(INLINE_PREFIX.length));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ShareDoc;
    } catch {
      return null;
    }
  }
  if (!db) return null;
  try {
    const { doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, 'shares', id));
    return snap.exists() ? (snap.data() as ShareDoc) : null;
  } catch {
    return null;
  }
}
