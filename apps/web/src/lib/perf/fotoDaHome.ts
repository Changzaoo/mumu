/**
 * A "FOTO" DA HOME DA ÚLTIMA VISITA — pequena, guardada à parte, lida num `get` só.
 *
 * No aparelho real a Home esperava a biblioteca INTEIRA (5,7 mil faixas lidas do
 * IndexedDB + acervo conferido com o servidor) para só então montar as
 * prateleiras. A primeira dobra da Home, porém, são oito atalhos e três ou
 * quatro prateleiras de 15 cartões: uns 70 títulos. Aqui fica exatamente isso —
 * id, título, artista, capa — para a Home pintar NO PRIMEIRO QUADRO com o que
 * a pessoa viu da última vez, enquanto a biblioteca real hidrata por trás.
 *
 * Mora num banco próprio e minúsculo (alguns kB): ler é um `get` de um objeto
 * pequeno, sem o custo de desserialização que os cofres grandes têm. O que NÃO
 * entra: prateleiras abaixo da primeira dobra, álbuns e artistas (têm a
 * biblioteca completa como fonte e aparecem quando ela chega) e qualquer URL
 * de áudio — a foto é só para OLHAR; tocar sempre resolve a faixa real.
 */
import type { TrackDto } from '@radinho/shared';

const DB = 'aurial-home-foto';
const STORE = 'foto';
const CHAVE = 'ultima';
const VERSAO = 1;
/** Mudou o formato? Sobe aqui e a foto antiga é ignorada. */
const FORMATO = 1;

export interface FaixaMini {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  durationMs: number;
}

export interface PrateleiraMini {
  /** `key` de React e `sourceId` da fila. */
  key: string;
  titulo: string;
  subtitulo?: string;
  faixas: FaixaMini[];
}

export interface FotoSalva {
  formato: number;
  /** Quando foi tirada (ms desde a época). */
  em: number;
  tronco: PrateleiraMini | null;
  ramos: PrateleiraMini[];
  daSemente: FaixaMini[];
  artistas: { name: string; coverUrl: string | null }[];
}

export function miniDaFaixa(t: TrackDto): FaixaMini {
  return {
    id: t.id,
    title: t.title,
    artist: t.artists[0]?.name ?? '',
    coverUrl: t.coverUrl ?? null,
    durationMs: t.durationMs,
  };
}

/**
 * Uma faixa "de mentira" só para DESENHAR o cartão (sem URL de áudio). Quem toca
 * resolve a faixa de verdade pelo id — ver `aguardarFaixaReal` na Home.
 */
export function faixaDaMini(m: FaixaMini): TrackDto {
  return {
    id: m.id,
    title: m.title,
    durationMs: m.durationMs,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    coverUrl: m.coverUrl,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: null,
    artists: [{ id: '', name: m.artist, slug: '', imageUrl: null }],
    streamUrl: null,
    uploadedByUserId: null,
  } as unknown as TrackDto;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSAO);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  }));
}

/** Lê a foto da última visita. `null` sem foto, sem IndexedDB ou em formato antigo. */
export async function lerFotoDaHome(): Promise<FotoSalva | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await abrir();
    const bruto = await new Promise<unknown>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(CHAVE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    const foto = bruto as FotoSalva | null | undefined;
    return foto && foto.formato === FORMATO && Array.isArray(foto.ramos) ? foto : null;
  } catch {
    return null;
  }
}

/** Guarda a foto (substitui a anterior). Best-effort: a Home nunca depende disto. */
export async function salvarFotoDaHome(foto: Omit<FotoSalva, 'formato' | 'em'>): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await abrir();
    const valor: FotoSalva = { ...foto, formato: FORMATO, em: Date.now() };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(valor, CHAVE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* sem IndexedDB a Home só perde o atalho do primeiro quadro */
  }
}
