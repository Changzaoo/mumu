/**
 * UM LINK COLADO É UM REGISTRO NA CONTA — o mesmo id no app e no servidor.
 *
 * Colar um link (música ou playlist) grava um item na coleção `importacoes` da
 * pessoa. Com o app aberto, o próprio aparelho baixa e marca "feito"; se ele
 * fechar antes, o worker do servidor encontra o registro ainda "pendente" e
 * termina o trabalho (apps/api/src/workers/importacoes.worker.ts). Os dois
 * lados precisam chegar ao MESMO id para o mesmo link — senão cada um criaria
 * o seu registro e a música seria baixada duas vezes.
 */

/** Estado de um link colado. */
export type EstadoDaImportacao = 'pendente' | 'feito' | 'expandida' | 'erro';

export interface ImportacaoNaConta {
  url: string;
  /** Link ambíguo (vídeo dentro de lista) que a pessoa pediu como playlist. */
  forcePlaylist?: boolean;
  estado: EstadoDaImportacao;
  criadoEm: string;
  atualizadoEm: string;
  titulo?: string;
  /** Quantas vezes o servidor já tentou (falha transitória). */
  tentativas?: number;
  erro?: string;
}

/** FNV-1a de 32 bits, em hexadecimal. */
function fnv(texto: string, semente: number): string {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Id estável do registro de um link (64 bits em duas metades). */
export function idDaImportacao(url: string): string {
  const u = url.trim();
  return `imp-${fnv(u, 0x811c9dc5)}${fnv(u, 0x01234567)}`;
}
