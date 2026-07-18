/**
 * Prateleiras SEMÂNTICAS — o que a heurística não consegue enxergar.
 *
 * `recommend.ts` raciocina por rótulo: mesmo artista, mesmo gênero. Isso é
 * sólido e nunca sai do ar, mas não explica por que duas músicas de gêneros
 * diferentes combinam. Aqui usamos os vetores (lib/reco/embeddings) para medir
 * proximidade real e montar duas prateleiras que a heurística não montaria:
 *
 *   1. "Na sua vibe"      — biblioteca ordenada pela distância ao SEU gosto.
 *   2. "Parecidas com X"  — vizinhas da última faixa que você ouviu.
 *
 * Este módulo é ADITIVO: se não há vetor suficiente (sem importer, deslogado,
 * offline, biblioteca recém-criada) ele devolve [] e a Home segue exatamente
 * como antes. Nada aqui pode piorar o caminho que já funciona.
 */
import type { TrackDto } from '@aurial/shared';
import type { Recommendation, RecoEntry, RecoPlay } from '@/lib/reco/recommend';
import { vectorOf } from '@/lib/reco/embeddings';
import {
  capPerKey,
  cosine,
  rankBySimilarity,
  recencyWeight,
  tasteVector,
} from '@/lib/reco/semantic';

/** Abaixo disso a semelhança não é sinal, é ruído — melhor não montar mix. */
const MIN_VECTORS = 12;
/** Teto por artista: um mix com 20 faixas do mesmo artista é um álbum. */
const MAX_PER_ARTIST = 3;
const MIX_SIZE = 30;
/** Curtida vale bem mais que um play — mesmo espírito do motor heurístico. */
const PESO_CURTIDA = 3;

function artistKey(track: TrackDto): string {
  return track.artists[0]?.name?.toLowerCase() ?? track.id;
}

function primeiraCapa(tracks: readonly TrackDto[]): string | null {
  return tracks.find((t) => t.coverUrl)?.coverUrl ?? null;
}

function capasDoMix(tracks: readonly TrackDto[]): string[] {
  const out: string[] = [];
  for (const track of tracks) {
    if (track.coverUrl && !out.includes(track.coverUrl)) out.push(track.coverUrl);
    if (out.length === 4) break;
  }
  return out;
}

function comArtistas(tracks: readonly TrackDto[]): string {
  const names: string[] = [];
  for (const track of tracks) {
    const name = track.artists[0]?.name;
    if (name && !names.includes(name)) names.push(name);
    if (names.length === 3) break;
  }
  return names.length > 0 ? `Com ${names.join(', ')}` : '';
}

export interface SemanticInputs {
  entries: readonly RecoEntry[];
  history: readonly RecoPlay[];
  liked: readonly TrackDto[];
  now?: Date;
}

/**
 * Monta as prateleiras semânticas. Devolve [] sempre que o sinal for fraco —
 * prateleira ruim é pior que prateleira ausente.
 */
export function buildSemanticMixes(inputs: SemanticInputs): Recommendation[] {
  const { entries, history, liked } = inputs;
  const now = inputs.now ?? new Date();

  const library = entries.map((e) => e.track);
  if (library.length < MIN_VECTORS) return [];

  // Quantos da biblioteca realmente têm vetor: sem massa crítica, a ordenação
  // seria feita sobre um punhado de faixas e pareceria arbitrária.
  const withVector = library.filter((t) => vectorOf(t) !== null);
  if (withVector.length < MIN_VECTORS) return [];

  // ── vetor de gosto ────────────────────────────────────────────
  const signals: Array<{ vector: readonly number[]; weight: number }> = [];
  for (const track of liked) {
    const vector = vectorOf(track);
    if (vector) signals.push({ vector, weight: PESO_CURTIDA });
  }
  for (const play of history.slice(0, 200)) {
    const vector = vectorOf(play.track);
    if (vector) signals.push({ vector, weight: recencyWeight(play.playedAt, now) });
  }
  const taste = tasteVector(signals);

  const out: Recommendation[] = [];

  // ── 1. Na sua vibe ────────────────────────────────────────────
  if (taste) {
    // Tira o que a pessoa acabou de ouvir: recomendar o que ela ouviu há 5
    // minutos não é recomendação, é repetição.
    const recent = new Set(history.slice(0, 25).map((p) => p.track.id));
    const candidates = withVector.filter((t) => !recent.has(t.id));
    const ranked = rankBySimilarity(taste, candidates, vectorOf);
    const tracks = capPerKey(ranked, artistKey, MAX_PER_ARTIST).slice(0, MIX_SIZE);
    if (tracks.length >= 8) {
      out.push({
        key: 'reco:vibe',
        title: 'Na sua vibe',
        subtitle: comArtistas(tracks),
        coverUrl: primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }

  // ── 2. Parecidas com a última que tocou ───────────────────────
  const seed = history[0]?.track;
  const seedVector = seed ? vectorOf(seed) : null;
  if (seed && seedVector) {
    const ranked = rankBySimilarity(
      seedVector,
      withVector.filter((t) => t.id !== seed.id),
      vectorOf,
    )
      // Corte de qualidade: abaixo disso "parecida" vira mentira.
      .filter((s) => s.score > 0.55);
    const tracks = capPerKey(ranked, artistKey, MAX_PER_ARTIST).slice(0, MIX_SIZE);
    if (tracks.length >= 8) {
      out.push({
        key: 'reco:similar',
        title: `Parecidas com ${seed.title}`,
        subtitle: comArtistas(tracks),
        coverUrl: seed.coverUrl ?? primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }

  return out;
}

/** Vizinhas semânticas de UMA faixa — usado fora da Home (ex.: fila infinita). */
export function similarTo(track: TrackDto, pool: readonly TrackDto[], limit = 20): TrackDto[] {
  const seed = vectorOf(track);
  if (!seed) return [];
  const ranked = rankBySimilarity(
    seed,
    pool.filter((t) => t.id !== track.id),
    vectorOf,
  ).filter((s) => cosine(seed, vectorOf(s.item) ?? []) > 0.5);
  return capPerKey(ranked, artistKey, MAX_PER_ARTIST).slice(0, limit);
}
