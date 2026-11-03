/**
 * Funções puras da restauração de cópias a partir do índice da borda
 * (`indice.json`: id → { c, a, k, t }). Ver `restaurarCopiasDoIndice.ts`.
 */

export interface EntradaDoIndice {
  /** repositório */
  c?: string;
  /** caminho no repositório */
  a?: string;
  /** token do cofre */
  k: string;
  /** mime */
  t?: string;
}
export type Indice = Map<string, EntradaDoIndice>;

type Obj = Record<string, unknown>;

export const ORIGEM_PUBLICA = 'https://importer.radinho.online';

/** Lê o texto do índice; entradas sem `k` válido são descartadas. */
export function lerIndice(texto: string): Indice {
  const bruto = JSON.parse(texto) as unknown;
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('indice.json precisa ser um objeto id → entrada');
  }
  const m: Indice = new Map();
  for (const [id, v] of Object.entries(bruto as Obj)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Obj;
    if (typeof e.k !== 'string' || !/^[0-9A-Za-z_-]+$/.test(e.k)) continue;
    m.set(id, {
      k: e.k,
      ...(typeof e.c === 'string' ? { c: e.c } : {}),
      ...(typeof e.a === 'string' ? { a: e.a } : {}),
      ...(typeof e.t === 'string' && e.t ? { t: e.t } : {}),
    });
  }
  return m;
}

/** `true` quando a entrada não tem `remoteUrl` utilizável. */
export function semRemoteUrl(dados: unknown): boolean {
  if (!dados || typeof dados !== 'object') return true;
  const r = (dados as Obj).remoteUrl;
  return typeof r !== 'string' || r.trim() === '';
}

export function urlDaCopia(id: string, k: string, origem = ORIGEM_PUBLICA): string {
  return `${origem.replace(/\/+$/, '')}/blob/${encodeURIComponent(id)}?k=${k}`;
}

/**
 * A entrada com a cópia restaurada: só `remoteUrl`, `track.streamUrl` e
 * `mimeType` mudam. `null` quando não há o que fazer (já tem cópia ou o id não
 * está no índice).
 */
export function restaurar(id: string, dados: unknown, indice: Indice): Obj | null {
  if (!semRemoteUrl(dados)) return null;
  const e = indice.get(id);
  if (!e) return null;
  const base: Obj =
    dados && typeof dados === 'object' && !Array.isArray(dados) ? (dados as Obj) : {};
  const url = urlDaCopia(id, e.k);
  const track = base.track && typeof base.track === 'object' ? (base.track as Obj) : null;
  return {
    ...base,
    remoteUrl: url,
    mimeType: e.t ?? 'audio/mpeg',
    ...(track ? { track: { ...track, streamUrl: url } } : { track: { streamUrl: url } }),
  };
}

export interface Totais {
  semRemote: number;
  noIndice: number;
  restauradas: number;
  foraDoIndice: number;
}

export const totaisVazios = (): Totais => ({
  semRemote: 0,
  noIndice: 0,
  restauradas: 0,
  foraDoIndice: 0,
});

/** `catalog_backup_remoteurl_YYYYMMDD` (UTC). */
export function nomeDoBackup(quando = new Date()): string {
  const s = quando.toISOString().slice(0, 10).replaceAll('-', '');
  return `catalog_backup_remoteurl_${s}`;
}
