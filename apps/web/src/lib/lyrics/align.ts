/**
 * Alinhamento forçado — dá TEMPO a uma letra que só tem TEXTO.
 *
 * Por que não usar direto o texto do ASR: transcrever canto sobre instrumental
 * erra bastante (rima virando outra palavra, refrão comido, "yeah" fantasma).
 * Mas o LRCLIB quase sempre tem a letra PLANA correta — falta só o tempo. Então
 * usamos o ASR apenas como RELÓGIO: casamos as palavras que ele ouviu com as
 * palavras que sabemos estarem certas, e cada linha herda o tempo da primeira
 * palavra dela. Texto vem da fonte confiável, tempo vem do áudio real.
 *
 * O casamento é uma subsequência comum (LCS) sobre tokens normalizados: tolera
 * palavra pulada, palavra inventada e ordem preservada — exatamente os erros
 * que um ASR comete. Nada aqui faz rede: é puro e testável.
 */

/** Uma palavra ouvida no áudio, com quando ela começa. */
export interface AsrWord {
  text: string;
  startMs: number;
}

/** Uma palavra da letra com o instante em que ela é CANTADA. */
export interface TimedWord {
  text: string;
  timeMs: number;
}

export interface AlignedLine {
  timeMs: number;
  text: string;
  /**
   * Tempo de CADA palavra da linha.
   *
   * Sem isto o karaokê acende a linha inteira de uma vez e fica sempre um pouco
   * atrás ou à frente do que está sendo cantado — a linha dura 4 segundos e o
   * destaque não diz onde a voz está dentro dela. Com o tempo por palavra o
   * destaque anda junto com a voz, que é o que "sincronizada" quer dizer.
   */
  words?: TimedWord[];
}

/** Normalização agressiva: só o que importa para comparar duas palavras. */
function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

/**
 * Índices de uma subsequência comum entre duas listas de tokens.
 * Devolve pares [indiceNaLetra, indiceNoAsr] em ordem crescente.
 *
 * O(n·m) em memória seria proibitivo para uma música inteira (letra ~400
 * tokens × ASR ~600 = 240k células — aceitável, mas crescemos com segurança):
 * limitamos o pareamento a uma JANELA em torno da diagonal, já que letra e
 * transcrição avançam juntas no tempo. Fora da janela o alinhamento seria
 * espúrio de qualquer forma.
 */
function commonSubsequence(a: string[], b: string[], band = 120): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  // dp[i][j] = tamanho da LCS de a[0..i) e b[0..j) — só dentro da banda.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const inBand = (i: number, j: number): boolean => Math.abs(i * (m / Math.max(1, n)) - j) <= band;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const prev = dp[i - 1] as Uint32Array;
      const cur = dp[i] as Uint32Array;
      if (inBand(i, j) && a[i - 1] === b[j - 1]) {
        cur[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        cur[j] = Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
      }
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cur = dp[i] as Uint32Array;
    const prev = dp[i - 1] as Uint32Array;
    if (inBand(i, j) && a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if ((prev[j] ?? 0) >= (cur[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

/**
 * Dá tempo às linhas de uma letra plana usando as palavras datadas do ASR.
 *
 * Retorna null quando o casamento é fraco demais para confiar (ASR de outra
 * música, instrumental, idioma trocado) — nesse caso é MUITO melhor mostrar a
 * letra sem sincronia do que sincronizada errado: karaokê fora de tempo é pior
 * que karaokê nenhum.
 */
export function alignLyrics(
  plainLines: string[],
  words: AsrWord[],
  opts: { minMatchRatio?: number } = {},
): AlignedLine[] | null {
  const minMatchRatio = opts.minMatchRatio ?? 0.35;
  const lines = plainLines.map((l) => l.trim());
  if (lines.length === 0 || words.length === 0) return null;

  // Tokens da letra, guardando a qual LINHA cada token pertence.
  const lyricTokens: string[] = [];
  const tokenLine: number[] = [];
  lines.forEach((line, lineIndex) => {
    for (const token of tokenize(line)) {
      lyricTokens.push(token);
      tokenLine.push(lineIndex);
    }
  });
  if (lyricTokens.length === 0) return null;

  const asrTokens = words.map((w) => normalizeToken(w.text));
  const pairs = commonSubsequence(lyricTokens, asrTokens);

  // Casou pouco = não é a mesma música (ou o ASR não entendeu nada).
  if (pairs.length / lyricTokens.length < minMatchRatio) return null;

  // Cada linha herda o tempo da PRIMEIRA palavra dela que foi reconhecida, e
  // guardamos também o tempo de CADA token casado — é isso que permite o
  // destaque andar palavra a palavra em vez de acender a linha toda.
  const lineStart = new Map<number, number>();
  const tempoDoToken = new Map<number, number>();
  for (const [lyricIndex, asrIndex] of pairs) {
    const line = tokenLine[lyricIndex];
    const word = words[asrIndex];
    if (line === undefined || !word) continue;
    tempoDoToken.set(lyricIndex, word.startMs);
    if (!lineStart.has(line)) lineStart.set(line, word.startMs);
  }
  if (lineStart.size === 0) return null;

  // Índice do primeiro token de cada linha, para recortar as palavras depois.
  const primeiroToken = new Map<number, number>();
  for (let i = 0; i < tokenLine.length; i += 1) {
    const linha = tokenLine[i]!;
    if (!primeiroToken.has(linha)) primeiroToken.set(linha, i);
  }

  // Linhas sem nenhuma palavra reconhecida (refrão comido pelo ASR) ficam sem
  // âncora — interpolamos entre as vizinhas conhecidas para não colapsarem
  // todas no mesmo instante.
  const out: AlignedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const known = lineStart.get(i);
    if (known !== undefined) {
      out.push({ timeMs: known, text: lines[i] ?? '' });
      continue;
    }
    let prevIndex = i - 1;
    while (prevIndex >= 0 && !lineStart.has(prevIndex)) prevIndex--;
    let nextIndex = i + 1;
    while (nextIndex < lines.length && !lineStart.has(nextIndex)) nextIndex++;
    const prevTime = prevIndex >= 0 ? (lineStart.get(prevIndex) ?? 0) : 0;
    const nextTime =
      nextIndex < lines.length
        ? (lineStart.get(nextIndex) ?? prevTime)
        : prevTime + (i - prevIndex) * 3000;
    const span = nextIndex - prevIndex;
    const step = span > 0 ? (nextTime - prevTime) / span : 0;
    out.push({ timeMs: Math.round(prevTime + step * (i - prevIndex)), text: lines[i] ?? '' });
  }

  // Monotonicidade: um tempo que anda para trás faz o destaque pular no
  // karaokê. Garantimos não-decrescente.
  let last = 0;
  for (const line of out) {
    if (line.timeMs < last) line.timeMs = last;
    last = line.timeMs;
  }

  // Tempo por palavra. Palavra que o ASR reconheceu tem tempo real; as que ele
  // comeu (rima virando outra coisa, "yeah" fantasma) são distribuídas entre as
  // vizinhas reconhecidas — melhor uma estimativa dentro do intervalo certo que
  // todas empilhadas no começo da linha.
  for (let i = 0; i < out.length; i += 1) {
    const linha = out[i]!;
    const inicio = primeiroToken.get(i);
    if (inicio === undefined) continue;

    const palavrasDoTexto = (lines[i] ?? '').split(/\s+/).filter(Boolean);
    const tokensDaLinha: number[] = [];
    for (let k = inicio; k < tokenLine.length && tokenLine[k] === i; k += 1) tokensDaLinha.push(k);
    // Pontuação faz o texto ter mais "palavras" que tokens; sem 1-para-1 o
    // mapeamento seria chute, então nem tenta.
    if (tokensDaLinha.length !== palavrasDoTexto.length || tokensDaLinha.length === 0) continue;

    const fim = out[i + 1]?.timeMs ?? linha.timeMs + palavrasDoTexto.length * 400;
    const tempos: number[] = tokensDaLinha.map((t) => tempoDoToken.get(t) ?? -1);

    // Interpola os buracos entre âncoras conhecidas.
    for (let k = 0; k < tempos.length; k += 1) {
      if (tempos[k]! >= 0) continue;
      let antes = k - 1;
      while (antes >= 0 && tempos[antes]! < 0) antes -= 1;
      let depois = k + 1;
      while (depois < tempos.length && tempos[depois]! < 0) depois += 1;
      const tAntes = antes >= 0 ? tempos[antes]! : linha.timeMs;
      const tDepois = depois < tempos.length ? tempos[depois]! : fim;
      const vao = depois - antes;
      tempos[k] = Math.round(tAntes + ((tDepois - tAntes) * (k - antes)) / Math.max(1, vao));
    }

    // Não-decrescente também dentro da linha.
    let anterior = linha.timeMs;
    linha.words = palavrasDoTexto.map((texto, k) => {
      const t = Math.max(tempos[k]!, anterior);
      anterior = t;
      return { text: texto, timeMs: t };
    });
  }

  return out;
}
