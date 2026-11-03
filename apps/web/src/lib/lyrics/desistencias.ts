/**
 * O IMPORTADOR JÁ DISSE "NÃO" PARA ESTA FAIXA — não pergunte de novo a cada play.
 *
 * Com TEMPO_LOCAL=0 todo `/alinhar` e `/tempo` respondem 422, e o cliente
 * repetia o POST (com a letra inteira no corpo) a cada reprodução e a cada vez
 * que a tela da letra abria. O importador guarda a própria falha por 6 h
 * (tempoDasPalavras.mjs); aqui é o espelho no aparelho, com o mesmo prazo, e
 * o 404 da borda ("ainda não calculado") por 1 h.
 *
 * Memória + localStorage (sobrevive à recarga). localStorage pode lançar ou
 * vir vazio (aba privada, cota): tudo em try/catch, e sem ele vale só a memória.
 */
const CHAVE = 'aurial:calibragem-desistiu';

export type MotivoDaDesistencia = 'alinhar' | 'tempo' | 'borda';

export const PRAZO_DA_DESISTENCIA_MS: Record<MotivoDaDesistencia, number> = {
  alinhar: 6 * 3600_000,
  tempo: 6 * 3600_000,
  borda: 3600_000,
};

/** Teto de entradas guardadas: as mais antigas saem. */
const TETO = 500;

let memoria: Record<string, number> | null = null;

function ler(): Record<string, number> {
  if (memoria) return memoria;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const obj: unknown = bruto ? JSON.parse(bruto) : {};
    memoria = obj && typeof obj === 'object' ? (obj as Record<string, number>) : {};
  } catch {
    memoria = {};
  }
  return memoria;
}

function gravar(): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(memoria ?? {}));
  } catch {
    /* sem armazenamento: vale a memória */
  }
}

export function marcarDesistencia(
  trackId: string,
  motivo: MotivoDaDesistencia,
  agora = Date.now(),
): void {
  const m = ler();
  const chave = `${trackId}|${motivo}`;
  delete m[chave];
  m[chave] = agora;
  const chaves = Object.keys(m);
  for (let i = 0; i < chaves.length - TETO; i += 1) delete m[chaves[i] as string];
  gravar();
}

export function desistiuHaPouco(
  trackId: string,
  motivo: MotivoDaDesistencia,
  agora = Date.now(),
): boolean {
  const quando = ler()[`${trackId}|${motivo}`];
  return typeof quando === 'number' && agora - quando < PRAZO_DA_DESISTENCIA_MS[motivo];
}

/** Para os testes. */
export function esquecerDesistencias(): void {
  memoria = {};
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* nada */
  }
}
