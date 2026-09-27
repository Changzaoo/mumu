// Tipos de buscaYoutube.mjs — só para o teste do app web (tsc -b) importá-lo.

export interface ResultadoBusca {
  url: string;
  titulo: string;
  canal: string;
  duracaoSeg: number;
  capa: string;
}

export const DURACAO_MIN_SEG: number;
export const DURACAO_MAX_SEG: number;
export function normalizarTermo(termo: unknown): string;
export function pareceMusica(entrada: unknown): boolean;
export function parseResultados(bruto: unknown): ResultadoBusca[];

export class LimiteDeBusca extends Error {
  constructor(esperarSeg: number);
  esperarSeg: number;
}

export function criarBuscaYoutube(opcoes?: {
  binario?: () => string;
  argsExtras?: () => string[];
  rodar?: (termo: string, quantos: number) => Promise<string>;
  agora?: () => number;
  quantos?: number;
}): { buscar: (termo: string, chaveUsuario?: string) => Promise<ResultadoBusca[]> };
