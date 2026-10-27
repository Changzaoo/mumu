/**
 * SÓ A LETRA — o que o provedor escreve entre colchetes não é cantado.
 *
 * A letra de texto puro (Genius e afins) vem com linhas de metadado:
 * `[Letra de "Mundo Fashion" ft. Matuê]`, `[Intro: Tz da Coronel]`,
 * `[Refrão: Tz da Coronel & Matuê]`, `[Verso 1: Matuê]`, `[Saída]`, `[x2]`…
 * Na tela elas apareciam como se fossem versos (print do Vinicius em
 * 27/10/2026, "Mundo Fashion"), e no alinhamento o modelo tentava achar no
 * áudio uma frase que ninguém canta.
 *
 * Regra: linha cujo conteúdo inteiro é um ou mais grupos entre colchetes é
 * cabeçalho e sai. Um rótulo de seção no COMEÇO de uma linha cantada
 * (`[Refrão] Baby, eu entro…`) é tirado e o verso fica. Colchete no meio de
 * frase fica como está — pode ser parte do texto.
 *
 * Puro (sem DOM, sem rede), para ser testado sem navegador e usado tanto
 * antes de gravar a letra quanto na exibição do que já estava em cache.
 */
import type { Lyrics, LyricLine } from '@/lib/lyrics/lyrics';

const SO_COLCHETES = /^\s*(?:\[[^\]]*\]\s*)+$/;
/**
 * Rótulo de seção colado no início de um verso. Só os nomes conhecidos de
 * seção (pt e en), com ou sem número e intérprete — um colchete qualquer no
 * começo da frase pode ser texto.
 */
const ROTULO_NO_INICIO =
  /^\s*\[\s*(?:letra\s+de|intro(?:du[cç][aã]o)?|refr[aã]o|pr[eé][\s-]*refr[aã]o|p[oó]s[\s-]*refr[aã]o|verso|estrofe|ponte|sa[ií]da|final|interl[uú]dio|instrumental|solo|coro|chorus|pre[\s-]*chorus|post[\s-]*chorus|verse|bridge|hook|outro|interlude|break(?:down)?|drop|skit|produced\s+by|produzido\s+por)\b[^\]]*\]\s*/i;

/** A linha inteira é metadado do provedor (não é cantada). */
export function ehCabecalho(texto: string): boolean {
  return SO_COLCHETES.test(texto);
}

/** O texto da linha sem o rótulo de seção no começo (`[Refrão] Eu vou` → `Eu vou`). */
export function semRotuloDeSecao(texto: string): string {
  return texto.replace(ROTULO_NO_INICIO, '');
}

/**
 * A letra sem as linhas de cabeçalho. Devolve o MESMO objeto quando não há o
 * que tirar (quem compara por identidade, como o react-query e os memos da
 * tela, não re-renderiza à toa). O branco que sobra logo depois de um
 * cabeçalho removido sai com ele; os outros brancos são da letra e ficam.
 */
export function semCabecalhos<T extends Lyrics>(letra: T): T;
export function semCabecalhos<T extends Lyrics>(letra: T | null | undefined): T | null | undefined;
export function semCabecalhos<T extends Lyrics>(letra: T | null | undefined): T | null | undefined {
  if (!letra || letra.lines.length === 0) return letra;
  let mudou = false;
  let removeuAntes = false;
  const lines: LyricLine[] = [];
  for (const linha of letra.lines) {
    if (ehCabecalho(linha.text)) {
      mudou = true;
      removeuAntes = true;
      continue;
    }
    const texto = semRotuloDeSecao(linha.text);
    const anterior = lines[lines.length - 1];
    // O branco logo DEPOIS de um cabeçalho removido, com outro branco (ou nada)
    // antes, é o rastro dele — sai. Qualquer outro branco é da letra (pausa
    // instrumental, "♪" na tela) e fica como veio.
    if (removeuAntes && !texto.trim() && (!anterior || !anterior.text.trim())) {
      mudou = true;
      removeuAntes = false;
      continue;
    }
    removeuAntes = false;
    if (texto === linha.text) {
      lines.push(linha);
      continue;
    }
    mudou = true;
    // Palavras com tempo: a tela desenha `words` quando existe, então o rótulo
    // tem que sair dali também — pelo texto, para não perder tempo nenhum.
    const words = linha.words ? ajustarPalavras(linha.words, linha.text, texto) : undefined;
    lines.push({ ...linha, text: texto, ...(words ? { words } : {}) });
  }
  return mudou ? { ...letra, lines } : letra;
}

/** Tira das `words` as que formavam o rótulo removido do começo da linha. */
function ajustarPalavras(
  words: NonNullable<LyricLine['words']>,
  antes: string,
  depois: string,
): NonNullable<LyricLine['words']> | undefined {
  const removidas =
    antes.split(/\s+/).filter(Boolean).length - depois.split(/\s+/).filter(Boolean).length;
  if (removidas <= 0 || removidas >= words.length) return undefined;
  return words.slice(removidas);
}
