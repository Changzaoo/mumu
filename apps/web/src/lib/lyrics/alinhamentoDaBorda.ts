/**
 * O RELÓGIO JÁ CALCULADO, SERVIDO PELA BORDA.
 *
 * Em produção o importador não alinha nada (TEMPO_LOCAL=0 no vnmax): todo
 * `/blob/:id/alinhar` respondia 422 e a letra ficava com o tempo do LRCLIB,
 * cronometrado para OUTRA gravação — segundos de erro quando a versão do
 * YouTube tem outra introdução. Os alinhamentos agora são calculados fora (o
 * mesmo palavras.py, sobre a letra do LRCLIB) e servidos estáticos:
 *
 *   GET https://musicas.radinho.online/blob/<id>/alinhar?k=<k>
 *     200 { linhas: [{ text, startMs, endMs, words: [{ text, startMs, endMs, prob }] }], motor, em }
 *     404 ainda não existe · 403 token errado
 *
 * O texto das linhas pode ser de OUTRA linha do LRCLIB que não a que o
 * aparelho escolheu (mesma música, outra grafia, uma linha a mais ou a
 * menos). Por isso o casamento é por TEXTO normalizado e em ordem — nunca
 * pelo hash da letra, nem por posição.
 */
import { normalizarLinhaDaLetra, semelhancaDeLinhas } from '@radinho/shared';
import { candidatosDaCopia } from '@/lib/audio/cdn';
import type { LinhaAlinhada, PalavraAlinhada } from '@/lib/lyrics/recalibrar';

/** A borda que guarda os alinhamentos prontos (a do GitHub, ver cdn.ts). */
export const BORDA_DOS_ALINHAMENTOS = 'https://musicas.radinho.online';

export interface LinhaDaBorda extends LinhaAlinhada {
  text: string;
}

export type RespostaDaBorda =
  | { tipo: 'pronto'; linhas: LinhaDaBorda[] }
  /** 404: o alinhamento desta faixa ainda não foi calculado. */
  | { tipo: 'nao-tem' }
  /** 403, 5xx, rede, corpo quebrado: não é "não tem" — não cai para o importador. */
  | { tipo: 'erro'; status?: number };

const COPIA = /^\/blob\/[^/]+$/;

function origemDe(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * URL do alinhamento pronto, derivada da `remoteUrl` da cópia
 * (`<importador>/blob/<id>?k=`): troca a origem pela borda e acrescenta
 * `/alinhar`. Prefere a borda dos alinhamentos quando ela está na lista do
 * cdn.ts; senão, a primeira borda viva. `null` quando não é cópia do cofre.
 */
export function urlDoAlinhamentoNaBorda(
  remoteUrl: string,
  candidatos: (remote: string) => string[] = candidatosDaCopia,
): string | null {
  let u: URL;
  try {
    u = new URL(remoteUrl);
  } catch {
    return null;
  }
  const k = u.searchParams.get('k');
  if (!COPIA.test(u.pathname) || !k) return null;
  const bordas = candidatos(remoteUrl)
    .map(origemDe)
    .filter((o): o is string => Boolean(o) && o !== u.origin);
  const origem =
    bordas.find((o) => o === BORDA_DOS_ALINHAMENTOS) ??
    bordas[0] ??
    (u.origin === BORDA_DOS_ALINHAMENTOS ? u.origin : BORDA_DOS_ALINHAMENTOS);
  return `${origem}${u.pathname}/alinhar?k=${encodeURIComponent(k)}`;
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Valida o corpo da borda; linha ou palavra torta sai, o resto fica. */
export function lerLinhasDaBorda(corpo: unknown): LinhaDaBorda[] | null {
  const linhas = (corpo as { linhas?: unknown } | null)?.linhas;
  if (!Array.isArray(linhas)) return null;
  const saida: LinhaDaBorda[] = [];
  for (const l of linhas) {
    if (!l || typeof l !== 'object') continue;
    const bruto = l as Record<string, unknown>;
    const text = typeof bruto.text === 'string' ? bruto.text : '';
    const startMs = numero(bruto.startMs);
    const endMs = numero(bruto.endMs);
    if (startMs === null || startMs < 0) continue;
    const words: PalavraAlinhada[] = [];
    if (Array.isArray(bruto.words)) {
      for (const w of bruto.words) {
        const p = w as Record<string, unknown> | null;
        const ws = numero(p?.startMs);
        if (!p || typeof p.text !== 'string' || ws === null) continue;
        words.push({
          text: p.text,
          startMs: ws,
          endMs: numero(p.endMs) ?? ws,
          prob: Math.max(0, Math.min(1, numero(p.prob) ?? 0)),
        });
      }
    }
    saida.push({ text, startMs, endMs: endMs ?? startMs, words });
  }
  return saida.length > 0 ? saida : null;
}

/** Pergunta à borda. Nunca lança. */
export async function buscarAlinhamentoNaBorda(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<RespostaDaBorda> {
  try {
    const res = await fetcher(url, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return { tipo: 'nao-tem' };
    if (!res.ok) return { tipo: 'erro', status: res.status };
    const linhas = lerLinhasDaBorda(await res.json().catch(() => null));
    return linhas ? { tipo: 'pronto', linhas } : { tipo: 'erro', status: res.status };
  } catch {
    return { tipo: 'erro' };
  }
}

/** Duas linhas são a mesma linha da letra a partir desta semelhança. */
export const MESMA_LINHA = 0.6;

/**
 * Casa as linhas da letra do aparelho (`textos`) com as da borda, EM ORDEM,
 * por texto normalizado: programação dinâmica que maximiza a soma das
 * semelhanças (≥ MESMA_LINHA conta como par). Linha faltando de um lado ou do
 * outro só fica sem par. Refrão repetido casa com a repetição certa porque a
 * ordem é preservada. Devolve, para cada texto, o índice da linha da borda
 * (ou -1).
 */
export function casarLinhasPorTexto(
  textos: readonly string[],
  daBorda: readonly string[],
): number[] {
  const a = textos.map(normalizarLinhaDaLetra);
  const b = daBorda.map(normalizarLinhaDaLetra);
  const n = a.length;
  const m = b.length;
  const par = new Array<number>(n).fill(-1);
  if (n === 0 || m === 0) return par;
  // dp[i][j] = melhor soma casando a[i..] com b[j..].
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const sim = (i: number, j: number): number => {
    const s = semelhancaDeLinhas(a[i] ?? '', b[j] ?? '');
    return s >= MESMA_LINHA ? s : 0;
  };
  for (let i = n - 1; i >= 0; i -= 1) {
    const cur = dp[i] as Float64Array;
    const prox = dp[i + 1] as Float64Array;
    for (let j = m - 1; j >= 0; j -= 1) {
      const s = sim(i, j);
      cur[j] = Math.max(prox[j] ?? 0, cur[j + 1] ?? 0, s > 0 ? s + (prox[j + 1] ?? 0) : 0);
    }
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    const s = sim(i, j);
    const cur = dp[i] as Float64Array;
    const prox = dp[i + 1] as Float64Array;
    if (s > 0 && Math.abs((cur[j] ?? 0) - (s + (prox[j + 1] ?? 0))) < 1e-9) {
      par[i] = j;
      i += 1;
      j += 1;
    } else if ((prox[j] ?? 0) >= (cur[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return par;
}

/** Linha sem par: confiança 0, não serve de âncora em aplicarAlinhamento. */
const SEM_PAR: LinhaAlinhada = { startMs: 0, endMs: 0, words: [] };

/**
 * As linhas da borda no formato que `aplicarAlinhamento` espera: uma por
 * texto enviado, na mesma ordem. `casadas` diz quantas acharam par.
 */
export function alinhadasParaAsLinhas(
  textos: readonly string[],
  daBorda: readonly LinhaDaBorda[],
): { linhas: LinhaAlinhada[]; casadas: number } {
  const par = casarLinhasPorTexto(
    textos,
    daBorda.map((l) => l.text),
  );
  let casadas = 0;
  const linhas = par.map((j) => {
    const l = j >= 0 ? daBorda[j] : undefined;
    if (!l) return SEM_PAR;
    casadas += 1;
    return { startMs: l.startMs, endMs: l.endMs, words: l.words };
  });
  return { linhas, casadas };
}

/** Confiança média só das linhas que acharam par (0 quando nenhuma achou). */
export function confiancaDasCasadas(linhas: readonly LinhaAlinhada[]): number {
  const comPalavras = linhas.filter((l) => l.words.length > 0);
  if (comPalavras.length === 0) return 0;
  const porLinha = comPalavras.map((l) => l.words.reduce((s, w) => s + w.prob, 0) / l.words.length);
  return porLinha.reduce((s, c) => s + c, 0) / porLinha.length;
}
