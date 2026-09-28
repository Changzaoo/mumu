/**
 * O QUE A TRANSCRIÇÃO ERROU, E A LETRA CONFIRMADA CORRIGE.
 *
 * Autotune e sotaque fazem o whisper ouvir "a ful" onde a letra publicada diz
 * "afu", ou "pela sol" onde é "pela Sul" — sempre do MESMO jeito, porque é a
 * MESMA gíria/pronúncia do MESMO artista. Sem aprender isso, cada faixa nova
 * do artista repete o mesmo erro.
 *
 * Aqui comparamos o que foi OUVIDO (transcrição livre) com o que já foi
 * CONFIRMADO como a letra de verdade (ver confirmarPelaVoz.ts) e extraímos os
 * pares `{ouvido, real}` — o vocabulário que `enviarAprendizado` manda para o
 * importador guardar por artista (apps/importer/vocabulario.mjs) e usar como
 * `initial_prompt` do whisper na próxima transcrição livre daquele artista.
 *
 * NUNCA mexe na letra que está na tela: isto só alimenta o aprendizado — é
 * best-effort, em segundo plano, depois que a letra já foi aceita.
 */
import { enviarAprendizadoDeLetra } from '@/lib/local/importerHelper';

export interface Correcao {
  ouvido: string;
  real: string;
}

function normalizarToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Correção com mais palavras que isto não é gíria — é uma região onde a
 *  transcrição e a letra confirmada não se casam bem, e aprender aquilo
 *  ensinaria ruído, não vocabulário. */
const MAX_PALAVRAS_POR_LADO = 3;

/**
 * Alinha a sequência OUVIDA contra a REAL por edição mínima (Levenshtein
 * clássico — substituir/inserir/remover custam 1) e devolve os TRECHOS onde
 * elas divergem, como pares ouvido→real. Pura.
 *
 * Um trecho só vira correção quando tem palavra dos DOIS lados — uma palavra
 * a mais ou a menos (só inserção ou só remoção) não é um erro de "ouviu
 * errado", é uma palavra que o modelo comeu ou inventou sozinha, e ensinar
 * isso como vocabulário não ajudaria em nada.
 */
export function extrairCorrecoes(ouvidas: readonly string[], real: readonly string[]): Correcao[] {
  const a = ouvidas.filter((w) => w.trim());
  const b = real.filter((w) => w.trim());
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const na = a.map(normalizarToken);
  const nb = b.map(normalizarToken);

  // custo[i][j] = edição mínima entre a[i:] e b[j:].
  const custo: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) custo[i]![m] = n - i;
  for (let j = m - 1; j >= 0; j -= 1) custo[n]![j] = m - j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const sub = na[i] === nb[j] ? 0 : 1;
      custo[i]![j] = Math.min(
        custo[i + 1]![j + 1]! + sub,
        custo[i + 1]![j]! + 1,
        custo[i]![j + 1]! + 1,
      );
    }
  }

  const correcoes: Correcao[] = [];
  let ladoA: string[] = [];
  let ladoB: string[] = [];
  const fechar = (): void => {
    if (
      ladoA.length > 0 &&
      ladoB.length > 0 &&
      ladoA.length <= MAX_PALAVRAS_POR_LADO &&
      ladoB.length <= MAX_PALAVRAS_POR_LADO
    ) {
      correcoes.push({ ouvido: ladoA.join(' ').toLowerCase(), real: ladoB.join(' ') });
    }
    ladoA = [];
    ladoB = [];
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const igual = na[i] === nb[j];
    const sub = igual ? 0 : 1;
    if (custo[i]![j] === custo[i + 1]![j + 1]! + sub) {
      if (igual) fechar();
      else {
        ladoA.push(a[i]!);
        ladoB.push(b[j]!);
      }
      i += 1;
      j += 1;
    } else if (custo[i]![j] === custo[i + 1]![j]! + 1) {
      ladoA.push(a[i]!);
      i += 1;
    } else {
      ladoB.push(b[j]!);
      j += 1;
    }
  }
  while (i < n) {
    ladoA.push(a[i]!);
    i += 1;
  }
  while (j < m) {
    ladoB.push(b[j]!);
    j += 1;
  }
  fechar();
  return correcoes;
}

/** Poucas correções não valem a viagem à rede. */
const MIN_CORRECOES_PARA_ENVIAR = 1;

/**
 * Compara o que foi ouvido com a letra recém-confirmada e manda o
 * aprendizado para o importador — fire-and-forget, nunca lança, nunca atrasa
 * quem chamou. Chamado depois que `letraConfirmadaPelaVoz` já aceitou a
 * letra (ver calibragem.ts): aprender de uma letra ainda não comprovada
 * ensinaria o erro de casamento, não a gíria do artista.
 */
export function aprenderComATranscricao(
  artista: string | undefined,
  ouvidas: readonly { text: string }[],
  letraConfirmada: readonly { text: string }[],
): void {
  if (!artista?.trim()) return;
  const ouvidoTokens = ouvidas.flatMap((w) => w.text.split(/\s+/)).filter(Boolean);
  const realTokens = letraConfirmada
    .map((l) => l.text)
    .filter((t) => !/^\s*\[[^\]]*\]\s*$/.test(t)) // cabeçalho de seção não é letra cantada
    .flatMap((t) => t.split(/\s+/))
    .filter(Boolean);
  const correcoes = extrairCorrecoes(ouvidoTokens, realTokens);
  if (correcoes.length < MIN_CORRECOES_PARA_ENVIAR) return;
  void enviarAprendizadoDeLetra(artista, correcoes).catch(() => undefined);
}
