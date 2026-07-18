/**
 * Núcleo da recomendação SEMÂNTICA — matemática pura de vetores.
 *
 * A recomendação heurística (lib/reco/recommend.ts) entende "mesmo artista" e
 * "mesmo gênero". Isso monta uma prateleira honesta, mas não é o que faz um mix
 * parecer bom: duas músicas podem ser de gêneros diferentes e combinarem, e
 * duas do mesmo gênero podem não ter nada a ver. Embeddings capturam essa
 * proximidade que o rótulo não captura.
 *
 * Aqui fica só o que é puro e testável: montar o texto que representa a faixa,
 * cosseno, e o "vetor de gosto" do usuário. Rede e cache ficam em embeddings.ts.
 */
import type { TrackDto } from '@aurial/shared';

/**
 * Texto que representa a faixa para o modelo. Título e artista carregam quase
 * toda a informação; o gênero desempata. Mantemos ESTÁVEL — mudar o formato
 * invalida todo vetor já cacheado (o cache é chaveado pelo hash deste texto).
 */
export function trackEmbeddingText(track: TrackDto): string {
  const artists = track.artists
    .map((a) => a.name?.trim())
    .filter(Boolean)
    .join(', ');
  const parts = [track.title.trim()];
  if (artists) parts.push(artists);
  if (track.genre) parts.push(track.genre);
  if (track.album?.title) parts.push(track.album.title);
  return parts.join(' — ');
}

/** Cosseno de dois vetores. Assume dimensões iguais; 0 quando algum é nulo. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Vetor unitário (norma 1). Devolve o próprio vetor quando a norma é 0. */
export function normalize(v: readonly number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return [...v];
  return v.map((x) => x / norm);
}

export interface TasteSignal {
  vector: readonly number[];
  /** Peso relativo do sinal (like vale mais que play, play recente vale mais). */
  weight: number;
}

/**
 * "Vetor de gosto": centróide ponderado dos sinais do usuário.
 *
 * Cada vetor entra NORMALIZADO antes da média — senão uma faixa com norma
 * maior dominaria o centróide por acidente de magnitude, não por relevância.
 */
export function tasteVector(signals: readonly TasteSignal[]): number[] | null {
  const usable = signals.filter((s) => s.vector.length > 0 && s.weight > 0);
  if (usable.length === 0) return null;
  const dim = usable[0]?.vector.length ?? 0;
  if (dim === 0) return null;

  const acc = new Array<number>(dim).fill(0);
  let totalWeight = 0;
  for (const signal of usable) {
    if (signal.vector.length !== dim) continue; // modelo trocado: ignora o antigo
    const unit = normalize(signal.vector);
    for (let i = 0; i < dim; i++) acc[i] = (acc[i] ?? 0) + (unit[i] ?? 0) * signal.weight;
    totalWeight += signal.weight;
  }
  if (totalWeight === 0) return null;
  return normalize(acc.map((x) => x / totalWeight));
}

/**
 * Peso de uma reprodução pela idade: decai pela metade a cada ~30 dias. O que
 * a pessoa ouve HOJE define o gosto mais do que o que ouvia no ano passado.
 */
export function recencyWeight(playedAt: string | number | Date, now = new Date()): number {
  const then = new Date(playedAt).getTime();
  if (!Number.isFinite(then)) return 0;
  const days = (now.getTime() - then) / 86_400_000;
  if (days < 0) return 1;
  return 2 ** (-days / 30);
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Ordena candidatos pela proximidade com o gosto. `vectorOf` devolve null para
 * quem ainda não tem vetor — esses ficam de fora em vez de irem para o fim com
 * score 0, que os faria parecer "recomendados, porém ruins".
 */
export function rankBySimilarity<T>(
  taste: readonly number[],
  candidates: readonly T[],
  vectorOf: (item: T) => readonly number[] | null,
): Array<Scored<T>> {
  const out: Array<Scored<T>> = [];
  for (const item of candidates) {
    const vector = vectorOf(item);
    if (!vector || vector.length === 0) continue;
    out.push({ item, score: cosine(taste, vector) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Diversifica um ranking: evita que o mix inteiro seja o mesmo artista só
 * porque ele domina o gosto. Mantém a ordem por afinidade, mas segura um teto
 * por chave — um mix com 20 faixas do mesmo artista não é um mix, é um álbum.
 */
export function capPerKey<T>(
  ranked: readonly Scored<T>[],
  keyOf: (item: T) => string,
  maxPerKey: number,
): T[] {
  const used = new Map<string, number>();
  const out: T[] = [];
  for (const { item } of ranked) {
    const key = keyOf(item);
    const count = used.get(key) ?? 0;
    if (count >= maxPerKey) continue;
    used.set(key, count + 1);
    out.push(item);
  }
  return out;
}
