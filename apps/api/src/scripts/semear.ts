/**
 * SEMEADOR — lógica pura (testável). O executável é `semearDoOuvirMusica.ts`.
 *
 * Regra de ouro: sem certeza, não baixa. `escolherResultado` só devolve um vídeo
 * que seja a música pedida, do artista pedido, em duração de música — nunca chute.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  chaveDaMusica,
  faixaDoResultado,
  norm,
  type ResultadoDaBusca,
} from '../workers/pesquisador.worker.js';

export interface MusicaDaLista {
  artista: string;
  titulo: string;
  genero?: string;
  posicao?: number;
  url?: string;
}

export interface Lista {
  fonte: string;
  coletadoEm: string;
  musicas: MusicaDaLista[];
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Valida a lista; lança Error com o motivo. */
export function lerLista(json: unknown): Lista {
  if (!json || typeof json !== 'object') throw new Error('lista: objeto esperado');
  const o = json as Record<string, unknown>;
  const fonte = texto(o.fonte);
  const coletadoEm = texto(o.coletadoEm);
  if (!fonte) throw new Error('lista: "fonte" ausente');
  if (!coletadoEm) throw new Error('lista: "coletadoEm" ausente');
  if (!Array.isArray(o.musicas)) throw new Error('lista: "musicas" deve ser um array');
  const musicas = o.musicas.map((m, i): MusicaDaLista => {
    const x = (m ?? {}) as Record<string, unknown>;
    const artista = texto(x.artista);
    const titulo = texto(x.titulo);
    if (!artista || !titulo) throw new Error(`lista: musicas[${i}] sem artista/titulo`);
    const r: MusicaDaLista = { artista, titulo };
    const genero = texto(x.genero);
    if (genero) r.genero = genero;
    if (typeof x.posicao === 'number' && Number.isFinite(x.posicao)) r.posicao = x.posicao;
    const url = texto(x.url);
    if (url) r.url = url;
    return r;
  });
  return { fonte, coletadoEm, musicas };
}

export function chaveDeDedup(artista: string, titulo: string): string {
  return chaveDaMusica(artista, titulo);
}

/** Remove repetidas (mesma chave), mantendo a primeira. */
export function semRepetidas(musicas: MusicaDaLista[]): MusicaDaLista[] {
  const vistas = new Set<string>();
  return musicas.filter((m) => {
    const k = chaveDeDedup(m.artista, m.titulo);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

const DURACAO_MIN_S = 90;
const DURACAO_MAX_S = 8 * 60;

/** `base` contém `trecho` em fronteira de palavra (ambos já normalizados). */
export function contemPalavras(base: string, trecho: string): boolean {
  if (!trecho) return false;
  return ` ${base} `.includes(` ${trecho} `);
}

const OFICIAL = /\b(?:topic|vevo|oficial|official)\b/i;

export interface Escolha {
  resultado: ResultadoDaBusca;
  faixa: { title: string; artists: string[] };
}

/**
 * Entre os resultados da busca, o melhor que É a música pedida; ou null.
 * Preferência: canal "- Topic"/oficial/o próprio artista; depois a ordem da busca.
 */
export function escolherResultado(
  artista: string,
  titulo: string,
  resultados: ResultadoDaBusca[],
): Escolha | null {
  const alvo = norm(titulo);
  if (!alvo) return null;
  const aceitos: Array<Escolha & { nota: number; i: number }> = [];
  resultados.forEach((r, i) => {
    if (!r || typeof r.titulo !== 'string' || typeof r.canal !== 'string') return;
    if (!(r.duracaoSeg >= DURACAO_MIN_S && r.duracaoSeg <= DURACAO_MAX_S)) return;
    const faixa = faixaDoResultado(artista, r);
    if (!faixa) return;
    if (!contemPalavras(norm(r.titulo), alvo)) return;
    const canal = norm(r.canal);
    const dono = norm(artista);
    let nota = 0;
    if (OFICIAL.test(r.canal)) nota += 2;
    if (canal === dono || canal.startsWith(`${dono} `)) nota += 2;
    aceitos.push({ resultado: r, faixa, nota, i });
  });
  if (aceitos.length === 0) return null;
  aceitos.sort((a, b) => b.nota - a.nota || a.i - b.i);
  const melhor = aceitos[0]!;
  return { resultado: melhor.resultado, faixa: melhor.faixa };
}

/** Estado retomável da semeadura, por chave "artista|título". */
export interface EstadoDaSemeadura {
  feitas: Record<string, { id: string; em: string }>;
  semResultado: Record<string, { em: string }>;
  falhas: Record<string, { em: string; motivo: string; tentativas: number }>;
}

export function estadoVazio(): EstadoDaSemeadura {
  return { feitas: {}, semResultado: {}, falhas: {} };
}

export function lerEstado(caminho: string): EstadoDaSemeadura {
  if (!existsSync(caminho)) return estadoVazio();
  try {
    const o = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<EstadoDaSemeadura>;
    return {
      feitas: o.feitas ?? {},
      semResultado: o.semResultado ?? {},
      falhas: o.falhas ?? {},
    };
  } catch {
    return estadoVazio();
  }
}

/** Grava por arquivo temporário + rename: queda no meio não corrompe o estado. */
export function gravarEstado(caminho: string, estado: EstadoDaSemeadura): void {
  const tmp = `${caminho}.tmp`;
  writeFileSync(tmp, JSON.stringify(estado, null, 2));
  renameSync(tmp, caminho);
}

/** Já resolvida (feita ou sem resultado)? Falhas ainda podem ser tentadas de novo. */
export function jaResolvida(estado: EstadoDaSemeadura, chave: string): boolean {
  return chave in estado.feitas || chave in estado.semResultado;
}

/** Falhas além disto deixam de ser tentadas automaticamente. */
export const MAX_TENTATIVAS = 3;

export function deveTentar(estado: EstadoDaSemeadura, chave: string): boolean {
  if (jaResolvida(estado, chave)) return false;
  return (estado.falhas[chave]?.tentativas ?? 0) < MAX_TENTATIVAS;
}
