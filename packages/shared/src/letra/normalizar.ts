/**
 * NORMALIZAÇÃO DE LETRA — a mesma régua no navegador e nos scripts Node.
 *
 * Tudo aqui é puro (sem DOM, sem rede). Era espelhado à mão entre
 * apps/web/src/lib/lyrics/lyrics.ts e apps/importer/outrasFontesDeLetra.mjs, e
 * as duas cópias já tinham divergido (uma casava "Ana" dentro de "Mariana").
 */

/**
 * Normalização frouxa para comparar título/artista/linha — EM QUALQUER ALFABETO.
 *
 * `\p{L}` e `\p{N}` guardam letra e número de qualquer escrita; os acentos caem
 * entre NFD e NFC (recompor devolve o hangul ao silabário). Uma versão antiga
 * terminava em `[^a-z0-9]` e apagava títulos inteiros em coreano, russo, árabe…
 */
export function normalizarParaComparar(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * `menor` aparece em `maior` como PALAVRA(S) inteira(s), não no meio de outra:
 * "Amor" não casa com "Amora", "Ana" não casa com "Mariana".
 */
export function contemPalavrasInteiras(maior: string, menor: string): boolean {
  if (!menor) return false;
  return ` ${maior} `.includes(` ${menor} `);
}

/** Tira "(feat …)", "[Official Video]", "- Ao Vivo", "feat X" do fim do título. */
export function limparTituloDaLetra(title: string | null | undefined): string {
  return String(title ?? '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(
      /\s*[-–—]\s*(?:ao\s+vivo|live|(?:\d{4}\s+)?remaster(?:ed)?.*|slowed.*|sped\s*up.*)$/i,
      ' ',
    )
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * MARCAS DE VERSÃO: o que faz duas faixas de mesmo título serem GRAVAÇÕES
 * diferentes (outra letra, outro tempo). "Remaster" fica de fora de propósito:
 * é a mesma performance.
 */
const MARCAS_DE_VERSAO: Array<[string, RegExp]> = [
  ['remix', /\b(?:remix|rmx|mix)\b/],
  ['ao-vivo', /\b(?:ao vivo|live|en vivo|en directo)\b/],
  ['acustico', /\b(?:acustico|acoustic|unplugged)\b/],
  ['slowed', /\b(?:slowed|reverb)\b/],
  ['sped', /\b(?:sped up|speed up|nightcore)\b/],
  ['instrumental', /\b(?:instrumental|karaoke|playback)\b/],
  ['cover', /\bcover\b/],
];

/** Quais marcas de versão o título carrega (normalizado por dentro). */
export function marcasDeVersao(title: string | null | undefined): string[] {
  const n = normalizarParaComparar(title);
  return MARCAS_DE_VERSAO.filter(([, re]) => re.test(n)).map(([nome]) => nome);
}

/** Texto de UMA linha da letra pronto para casar com outra cópia dela. */
export function normalizarLinhaDaLetra(s: string | null | undefined): string {
  return normalizarParaComparar(s);
}

/**
 * Semelhança entre duas linhas já normalizadas (0–1): proporção de palavras
 * em comum sobre a linha MAIOR. Igual = 1. Serve para casar a mesma letra
 * vinda de duas linhas do LRCLIB (uma com "tá", outra com "está").
 */
export function semelhancaDeLinhas(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const restam = new Map<string, number>();
  for (const t of tb) restam.set(t, (restam.get(t) ?? 0) + 1);
  let comuns = 0;
  for (const t of ta) {
    const n = restam.get(t) ?? 0;
    if (n > 0) {
      comuns += 1;
      restam.set(t, n - 1);
    }
  }
  return comuns / Math.max(ta.length, tb.length);
}
