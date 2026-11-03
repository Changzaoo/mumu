/**
 * LRC — o formato de letra com tempo do LRCLIB, da NetEase e do LRC estendido.
 *
 *   [ti:Título]                 cabeçalho: ignorado
 *   [offset:+250]               deslocamento global (tempo efetivo = t − offset)
 *   [00:12.34]Verso             tempo de linha (fração de 1 a 3 dígitos)
 *   [00:12.34][01:02.00]Refrão  a mesma linha em vários instantes
 *   [00:12.00]<00:12.00>Eu <00:12.40>vou   tempo por palavra ("A2")
 *
 * Puro: roda igual no navegador e num script Node.
 */

export interface PalavraLrc {
  text: string;
  timeMs: number;
}

export interface LinhaLrc {
  timeMs: number;
  text: string;
  words?: PalavraLrc[];
}

/** Marcas de tempo NO COMEÇO da linha (uma ou várias seguidas). */
const TEMPOS_NO_INICIO = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const UM_TEMPO = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i;
/** Crédito que a NetEase põe como "verso" no começo: "作词 : Fulano". */
const CREDITO = /^\s*(?:作词|作曲|编曲|制作人|混音|母带|和声|吉他|词|曲)\s*[:：]/;

function fracaoEmMs(frac: string | undefined): number {
  // ".5" é meio segundo, ".05" é 50 ms, ".005" é 5 ms.
  return frac ? Number(`${frac}000`.slice(0, 3)) : 0;
}

const TAG_DE_PALAVRA = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;

/**
 * LRC ESTENDIDO: texto limpo e, quando havia marcas `<mm:ss.xx>`, o tempo real
 * de cada palavra. O texto ANTES da primeira marca também é cantado: entra no
 * instante da linha (`inicioMs`, já com o offset aplicado).
 */
export function lerPalavrasMarcadas(
  bruto: string,
  offsetMs: number,
  inicioMs = 0,
): { text: string; words?: PalavraLrc[] } {
  TAG_DE_PALAVRA.lastIndex = 0;
  if (!TAG_DE_PALAVRA.test(bruto)) return { text: bruto.trim() };
  TAG_DE_PALAVRA.lastIndex = 0;
  const words: PalavraLrc[] = [];
  const partes = bruto.split(TAG_DE_PALAVRA);
  for (const texto of (partes[0] ?? '').split(/\s+/).filter(Boolean)) {
    words.push({ text: texto, timeMs: inicioMs });
  }
  for (let i = 1; i + 3 < partes.length + 1; i += 4) {
    const min = Number(partes[i]);
    const seg = Number(partes[i + 1]);
    const t = Math.max(0, (min * 60 + seg) * 1000 + fracaoEmMs(partes[i + 2]) - offsetMs);
    for (const texto of (partes[i + 3] ?? '').split(/\s+/).filter(Boolean)) {
      words.push({ text: texto, timeMs: t });
    }
  }
  const text = bruto.replace(TAG_DE_PALAVRA, '').replace(/\s+/g, ' ').trim();
  return words.length > 0 ? { text, words } : { text };
}

/**
 * LRC → linhas em ordem de tempo. Linha sem marca de tempo (cabeçalho, texto
 * solto) fica de fora; linha com marca e sem texto fica (é a pausa).
 */
export function parseLrc(lrc: string | null | undefined): LinhaLrc[] {
  const texto = String(lrc ?? '').replace(/^\uFEFF/, '');
  const offset = Number(OFFSET.exec(texto)?.[1] ?? 0) || 0;
  const out: LinhaLrc[] = [];
  for (const raw of texto.split(/\r\n|\r|\n/)) {
    const cabeca = TEMPOS_NO_INICIO.exec(raw);
    if (!cabeca) continue;
    const times: number[] = [];
    UM_TEMPO.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UM_TEMPO.exec(cabeca[0])) !== null) {
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + fracaoEmMs(m[3]));
    }
    if (times.length === 0) continue;
    const resto = raw.slice(cabeca[0].length);
    if (CREDITO.test(resto)) continue;
    const { text, words } = lerPalavrasMarcadas(
      resto,
      offset,
      Math.max(0, (times[0] ?? 0) - offset),
    );
    for (const t of times) {
      // Marcas de palavra são absolutas: só valem para uma linha de tempo único.
      const comPalavras = words && times.length === 1;
      out.push({ timeMs: Math.max(0, t - offset), text, ...(comPalavras ? { words } : {}) });
    }
  }
  // sort estável: duas linhas no mesmo instante ficam na ordem do arquivo.
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/** O LRC sem nenhuma marca: só o texto, uma linha por verso. */
export function lrcSemTempo(lrc: string | null | undefined): string[] {
  return String(lrc ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\[[^\]]*\]|<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim())
    .filter(Boolean);
}
