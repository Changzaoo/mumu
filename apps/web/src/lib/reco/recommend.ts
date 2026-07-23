/**
 * Motor de recomendação 100% LOCAL — zero rede, zero dependências novas.
 *
 * Sinais usados (todos já existentes no app):
 *   - histórico de reprodução (localHistory): quando e o quê tocou;
 *   - curtidas (localLikes): gosto explícito;
 *   - biblioteca (localLibrary): faixas/artistas/gêneros e addedAt.
 *
 * Técnicas:
 *   1. AFINIDADE COM DECAIMENTO TEMPORAL — cada play vale e^(-dias/14)
 *      (meia-vida ≈ 10 dias): o que você ouviu ontem pesa muito mais que o
 *      que ouviu há dois meses. Curtida = bônus fixo x3 no artista/gênero.
 *   2. MIXES DIÁRIOS POR CLUSTER — os top artistas são agrupados pelo gênero
 *      dominante deles; cada cluster vira um mix cujo conteúdo é ordenado por
 *      (afinidade × frescor aleatório DETERMINÍSTICO — PRNG mulberry32 semeado
 *      pelo dia do ano, então o mix muda a cada dia mas é estável DENTRO do dia).
 *   3. "DE VOLTA AOS SEUS OUVIDOS" — nostalgia: faixas com afinidade histórica
 *      (decaimento lento e^(-dias/90)) mas sem NENHUM play nos últimos 21 dias.
 *   4. "DESCOBERTAS NA SUA BIBLIOTECA" — faixas NUNCA tocadas de artistas ou
 *      gêneros com boa afinidade, priorizando as adicionadas há pouco (addedAt).
 *   5. "PARA AGORA" — histograma hora-do-dia do próprio histórico: se há sinal
 *      suficiente (≥8 plays na janela de ±2h em volta da hora atual), recomenda
 *      o que o usuário costuma ouvir NESTE horário.
 *   6. COLD START — com <10 plays o motor degrada para os mixes simples por
 *      gênero/artista da biblioteca (comportamento antigo); nunca prateleira vazia.
 *
 * PERFORMANCE: uma única passada O(n) pelo histórico + duas passadas lineares
 * pela biblioteca (índices e descobertas); nenhuma alocação quadrática. O
 * resultado do caminho padrão é memoizado em variável de módulo por
 * (referência da biblioteca + dia + tamanho do histórico) — a Home pode chamar
 * a cada render sem custo.
 */
import type { TrackDto } from '@aurial/shared';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import type { LocalAlbum } from '@/lib/local/localLibrary';

export interface Recommendation {
  /** `genre:<nome>` / `artist:<nome>` abrem em /mix/:key; `reco:*` só tocam. */
  key: string;
  title: string;
  subtitle: string;
  coverUrl: string | null;
  /** Até 4 capas DISTINTAS das faixas — o card vira colagem 2×2 com cara de
   *  mix. Uma capa única fazia o mix parecer um álbum específico que não
   *  tinha nada a ver com o conteúdo. */
  coverUrls: string[];
  tracks: TrackDto[];
}

/** Formatos estruturais mínimos — LibraryEntry/LocalHistoryEntry são supersets. */
export interface RecoPlay {
  playedAt: string;
  track: TrackDto;
}
export interface RecoEntry {
  track: TrackDto;
  addedAt: string;
}
export interface RecoInputs {
  entries: readonly RecoEntry[];
  history: readonly RecoPlay[];
  liked: readonly TrackDto[];
  now?: Date;
}

export interface AlbumRecoInputs {
  entries: readonly RecoEntry[];
  history: readonly RecoPlay[];
  liked: readonly TrackDto[];
  albums: readonly LocalAlbum[];
  now?: Date;
}

// ── constantes do modelo ────────────────────────────────────────
const MEIA_VIDA_CURTA = 14; // dias — afinidade "do momento" (mixes diários)
const MEIA_VIDA_LONGA = 90; // dias — afinidade "de vida" (nostalgia)
const BONUS_CURTIDA = 3; // curtida vale ~3 plays recentes no artista/gênero
const MIN_PLAYS_MOTOR = 10; // abaixo disso: cold start → fallback simples
const DIAS_NOSTALGIA = 21; // "De volta": sem play há pelo menos isto
const JANELA_HORAS = 2; // "Para agora": hora atual ±2h
const MIN_PLAYS_JANELA = 8; // sinal mínimo para a prateleira por hora

// ── PRNG determinístico (mulberry32) + seed do dia ──────────────
/** PRNG rápido e determinístico — NUNCA Math.random: o conteúdo dos mixes
 *  precisa ser estável ao longo do dia (mesma seed → mesma ordem). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed diária: ano×1000 + dia do ano — muda à meia-noite, estável no dia. */
export function daySeed(now: Date = new Date()): number {
  const inicioDoAno = new Date(now.getFullYear(), 0, 1);
  const dia = Math.floor((now.getTime() - inicioDoAno.getTime()) / 86_400_000) + 1;
  return now.getFullYear() * 1000 + dia;
}

/** Hash FNV-1a — combina o id da faixa com a seed do dia num frescor [0,1). */
function hashStr(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Frescor determinístico por (faixa, dia) — puro: independe da ordem de iteração. */
function frescorDoDia(trackId: string, seed: number): number {
  return mulberry32(hashStr(trackId) ^ Math.imul(seed, 0x9e3779b1))();
}

/** Fisher–Yates com seed — usado pela Home para tocar o mix embaralhado
 *  de forma estável dentro do mesmo dia. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

/** "Com A, B, C e mais" — subtítulo dos cards de mix. */
function comArtistas(tracks: readonly TrackDto[], max = 3): string {
  const names: string[] = [];
  for (const t of tracks) {
    const name = t.artists[0]?.name;
    if (name && name !== 'Desconhecido' && !names.includes(name)) names.push(name);
    if (names.length >= max) break;
  }
  if (names.length === 0) return 'Várias faixas';
  return `Com ${names.join(', ')}${tracks.length > names.length ? ' e mais' : ''}`;
}

function primeiraCapa(tracks: readonly TrackDto[]): string | null {
  for (const t of tracks) if (t.coverUrl) return t.coverUrl;
  return null;
}

/** Até `max` capas distintas do mix (colagem 2×2 no card). */
function capasDoMix(tracks: readonly TrackDto[], max = 4): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    if (t.coverUrl && !out.includes(t.coverUrl)) out.push(t.coverUrl);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Monta a tracklist do mix INTERCALANDO artistas (round-robin na ordem de
 * score): sem isto o score do artista líder somava em TODAS as faixas dele e
 * um artista com muitas faixas dominava o mix inteiro — "mix" com cara de
 * discografia. Cada artista entra com no máximo `porArtista` faixas.
 */
function intercalaPorArtista(
  cand: ReadonlyArray<{ t: TrackDto; score: number }>,
  porArtista: number,
  total: number,
): TrackDto[] {
  const buckets = new Map<string, TrackDto[]>();
  const ordem: string[] = [];
  for (const c of cand) {
    const key = norm(c.t.artists[0]?.name ?? '');
    let bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, (bucket = []));
      ordem.push(key);
    }
    if (bucket.length < porArtista) bucket.push(c.t);
  }
  const out: TrackDto[] = [];
  for (let rodada = 0; rodada < porArtista && out.length < total; rodada++) {
    let adicionou = false;
    for (const key of ordem) {
      const t = buckets.get(key)?.[rodada];
      if (!t) continue;
      out.push(t);
      adicionou = true;
      if (out.length >= total) break;
    }
    if (!adicionou) break;
  }
  return out;
}

function periodoDoDia(hour: number): string {
  if (hour < 6) return 'de madrugada';
  if (hour < 12) return 'de manhã';
  if (hour < 18) return 'à tarde';
  return 'à noite';
}

function albumArtistKey(album: LocalAlbum): string {
  return norm(album.artist);
}

function bumpAffinity(
  artistScore: Map<string, number>,
  genreScore: Map<string, number>,
  track: TrackDto,
  weight: number,
): void {
  for (const artist of track.artists) {
    const name = artist.name?.trim();
    if (!name || name === 'Desconhecido') continue;
    bump(artistScore, norm(name), weight);
  }
  const g = track.genre?.trim();
  if (g) bump(genreScore, g.toLowerCase(), weight);
}

// ── índices da biblioteca (uma passada) ─────────────────────────
interface ArtistBucket {
  name: string;
  tracks: TrackDto[];
  /** contagem de gênero das faixas do artista → gênero dominante do cluster */
  genreCounts: Map<string, { name: string; count: number }>;
}
interface GenreBucket {
  name: string;
  tracks: TrackDto[];
}

// ── motor ───────────────────────────────────────────────────────
function compute(inputs: RecoInputs): Recommendation[] {
  const now = inputs.now ?? new Date();
  const nowMs = now.getTime();
  const seed = daySeed(now);
  const recentTrackIds = new Set(inputs.history.slice(0, 20).map((p) => p.track.id));

  // Passada única pela BIBLIOTECA: índices por faixa, artista e gênero.
  const trackById = new Map<string, TrackDto>();
  const addedAtById = new Map<string, number>();
  const artistIdx = new Map<string, ArtistBucket>();
  const genreIdx = new Map<string, GenreBucket>();

  for (const entry of inputs.entries) {
    const t = entry.track;
    trackById.set(t.id, t);
    const addedMs = Date.parse(entry.addedAt);
    addedAtById.set(t.id, Number.isFinite(addedMs) ? addedMs : nowMs);
    const gName = t.genre?.trim();
    const gKey = gName ? gName.toLowerCase() : null;
    if (gName && gKey) {
      let g = genreIdx.get(gKey);
      if (!g) genreIdx.set(gKey, (g = { name: gName, tracks: [] }));
      g.tracks.push(t);
    }
    for (const artist of t.artists) {
      const name = artist.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      const key = norm(name);
      let bucket = artistIdx.get(key);
      if (!bucket) artistIdx.set(key, (bucket = { name, tracks: [], genreCounts: new Map() }));
      bucket.tracks.push(t);
      if (gName && gKey) {
        const gc = bucket.genreCounts.get(gKey);
        if (gc) gc.count += 1;
        else bucket.genreCounts.set(gKey, { name: gName, count: 1 });
      }
    }
  }

  // Passada única pelo HISTÓRICO: afinidades com decaimento + histograma de hora.
  const artistScore = new Map<string, number>(); // e^(-dias/14) por play
  const genreScore = new Map<string, number>();
  const fastByTrack = new Map<string, number>(); // afinidade "do momento" da faixa
  const slowByTrack = new Map<string, number>(); // afinidade "de vida" (nostalgia)
  const playsByTrack = new Map<string, number>(); // contagem crua
  const lastPlayed = new Map<string, number>(); // último play (ms)
  const nowScore = new Map<string, number>(); // afinidade na janela de hora atual
  let playsNaJanela = 0;
  const horaAtual = now.getHours();

  for (const play of inputs.history) {
    const at = Date.parse(play.playedAt);
    if (!Number.isFinite(at)) continue;
    const dias = Math.max(0, (nowMs - at) / 86_400_000);
    const w = Math.exp(-dias / MEIA_VIDA_CURTA);
    const ws = Math.exp(-dias / MEIA_VIDA_LONGA);
    const t = play.track;
    bump(fastByTrack, t.id, w);
    bump(slowByTrack, t.id, ws);
    bump(playsByTrack, t.id, 1);
    if (at > (lastPlayed.get(t.id) ?? 0)) lastPlayed.set(t.id, at);
    for (const artist of t.artists) {
      const name = artist.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      bump(artistScore, norm(name), w);
    }
    const g = t.genre?.trim();
    if (g) bump(genreScore, g.toLowerCase(), w);
    // Histograma hora-do-dia: só interessa a janela circular ±2h da hora atual.
    const h = new Date(at).getHours();
    const dist = Math.min(Math.abs(h - horaAtual), 24 - Math.abs(h - horaAtual));
    if (dist <= JANELA_HORAS) {
      playsNaJanela += 1;
      bump(nowScore, t.id, ws);
    }
  }

  // Curtidas: gosto explícito → bônus x3 no artista e no gênero da faixa.
  const likedIds = new Set<string>();
  for (const liked of inputs.liked) {
    likedIds.add(liked.id);
    const t = trackById.get(liked.id) ?? liked;
    for (const artist of t.artists) {
      const name = artist.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      bump(artistScore, norm(name), BONUS_CURTIDA);
    }
    const g = t.genre?.trim();
    if (g) bump(genreScore, g.toLowerCase(), BONUS_CURTIDA);
  }

  // COLD START: pouco histórico → mixes simples por gênero/artista (comportamento antigo).
  if (inputs.history.length < MIN_PLAYS_MOTOR) return fallbackMixes(genreIdx, artistIdx);

  const out: Recommendation[] = [];

  // ── 2. Mixes diários por CLUSTER de afinidade (até 4) ─────────
  // Top artistas por afinidade, agrupados pelo gênero dominante de cada um.
  const ranked = [...artistScore.entries()]
    .filter(([key, score]) => score > 0.01 && artistIdx.has(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  interface Cluster {
    genreName: string | null;
    artists: string[];
    score: number;
  }
  const clusters = new Map<string, Cluster>();
  for (const [aKey, score] of ranked) {
    const bucket = artistIdx.get(aKey)!;
    let dominante: { key: string; name: string; count: number } | null = null;
    for (const [gKey, gc] of bucket.genreCounts) {
      if (!dominante || gc.count > dominante.count) {
        dominante = { key: gKey, name: gc.name, count: gc.count };
      }
    }
    const cKey = dominante ? `g:${dominante.key}` : `a:${aKey}`;
    let cluster = clusters.get(cKey);
    if (!cluster) {
      clusters.set(cKey, (cluster = { genreName: dominante?.name ?? null, artists: [], score: 0 }));
    }
    cluster.artists.push(aKey);
    cluster.score += score;
  }

  const topClusters = [...clusters.values()].sort((a, b) => b.score - a.score).slice(0, 4);
  for (const cluster of topClusters) {
    const seen = new Set<string>();
    const cand: Array<{ t: TrackDto; score: number }> = [];
    for (const aKey of cluster.artists) {
      const aScore = artistScore.get(aKey) ?? 0;
      for (const t of artistIdx.get(aKey)!.tracks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        // afinidade × frescor determinístico do dia (0.6–1.4): o mix "gira" a
        // cada dia sem nunca ficar aleatório dentro do mesmo dia.
        const base = aScore + (fastByTrack.get(t.id) ?? 0) + (likedIds.has(t.id) ? 1 : 0);
        const repeatPenalty = recentTrackIds.has(t.id) ? 0.55 : 1;
        cand.push({ t, score: base * repeatPenalty * (0.6 + 0.8 * frescorDoDia(t.id, seed)) });
      }
    }
    if (cand.length < 4) continue;
    cand.sort((a, b) => b.score - a.score);
    // Rodízio por artista (máx. 5 faixas cada): variedade de verdade em vez
    // de 25 faixas do artista líder.
    const tracks = intercalaPorArtista(cand, 5, 25);
    const lead = artistIdx.get(cluster.artists[0]!)!.name;
    out.push({
      // /mix/:key só entende genre:/artist: — cluster com gênero usa a chave de
      // gênero (aproximação boa); sem gênero, a do artista líder.
      key: cluster.genreName ? `genre:${cluster.genreName}` : `artist:${lead}`,
      title: cluster.genreName ? `Seu mix de ${cluster.genreName}` : `Mix de ${lead}`,
      subtitle: comArtistas(tracks),
      coverUrl: primeiraCapa(tracks),
      coverUrls: capasDoMix(tracks),
      tracks,
    });
  }

  // ── 5. "Para agora" (hora-consciente) ─────────────────────────
  if (playsNaJanela >= MIN_PLAYS_JANELA) {
    const cand: Array<{ t: TrackDto; score: number }> = [];
    for (const [id, score] of nowScore) {
      const t = trackById.get(id);
      if (t) cand.push({ t, score });
    }
    if (cand.length >= 4) {
      cand.sort((a, b) => b.score - a.score);
      const tracks = cand.slice(0, 25).map((c) => c.t);
      out.push({
        key: 'reco:now',
        title: 'Para agora',
        subtitle: `O que você costuma ouvir ${periodoDoDia(horaAtual)}`,
        coverUrl: primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }

  // ── 3. "De volta aos seus ouvidos" (nostalgia) ────────────────
  // Alta afinidade histórica (≥2 plays ou curtida) e NENHUM play há ≥21 dias.
  {
    const cand: Array<{ t: TrackDto; score: number }> = [];
    for (const [id, last] of lastPlayed) {
      const t = trackById.get(id);
      if (!t) continue; // saiu da biblioteca — não recomendamos o que não toca
      if ((nowMs - last) / 86_400_000 < DIAS_NOSTALGIA) continue;
      if ((playsByTrack.get(id) ?? 0) < 2 && !likedIds.has(id)) continue;
      cand.push({ t, score: (slowByTrack.get(id) ?? 0) + (likedIds.has(id) ? 1 : 0) });
    }
    if (cand.length >= 4) {
      cand.sort((a, b) => b.score - a.score);
      const tracks = cand.slice(0, 30).map((c) => c.t);
      out.push({
        key: 'reco:back',
        title: 'De volta aos seus ouvidos',
        subtitle: 'Faixas que você amava e não ouve há um tempo',
        coverUrl: primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }

  // ── 4. "Descobertas na sua biblioteca" ────────────────────────
  // Nunca tocadas, de artistas/gêneros com afinidade, recém-adicionadas primeiro.
  {
    const cand: Array<{ t: TrackDto; score: number }> = [];
    for (const entry of inputs.entries) {
      const t = entry.track;
      if (playsByTrack.has(t.id)) continue; // só o que NUNCA tocou
      let aff = 0;
      for (const artist of t.artists) {
        const s = artistScore.get(norm(artist.name?.trim() ?? '')) ?? 0;
        if (s > aff) aff = s;
      }
      const g = t.genre?.trim();
      if (g) aff += 0.5 * (genreScore.get(g.toLowerCase()) ?? 0);
      if (aff <= 0.05) continue; // sem afinidade nenhuma, não é "descoberta"
      const diasAdd = Math.max(0, (nowMs - (addedAtById.get(t.id) ?? nowMs)) / 86_400_000);
      // boost de frescor de catálogo: adicionada há pouco sobe (até 2×)
      cand.push({ t, score: aff * (1 + Math.exp(-diasAdd / 30)) });
    }
    if (cand.length >= 4) {
      cand.sort((a, b) => b.score - a.score);
      const tracks = cand.slice(0, 30).map((c) => c.t);
      out.push({
        key: 'reco:discover',
        title: 'Descobertas na sua biblioteca',
        subtitle: 'Faixas suas que você ainda não ouviu',
        coverUrl: primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }

  // Nunca prateleira vazia: se nada acima rendeu (ex.: plays de faixas que já
  // saíram da biblioteca), volta ao fallback simples.
  return out.length > 0 ? out : fallbackMixes(genreIdx, artistIdx);
}

function computeAlbumRecommendations(inputs: AlbumRecoInputs): LocalAlbum[] {
  const now = inputs.now ?? new Date();
  const nowMs = now.getTime();
  const seed = daySeed(now);
  if (inputs.albums.length === 0) return [];

  const artistScore = new Map<string, number>();
  const genreScore = new Map<string, number>();
  const playedTrackIds = new Set<string>();
  const recentTrackIds = new Set(inputs.history.slice(0, 40).map((p) => p.track.id));
  const likedIds = new Set(inputs.liked.map((t) => t.id));
  const addedAtById = new Map<string, number>();
  for (const entry of inputs.entries) {
    const ms = Date.parse(entry.addedAt);
    if (Number.isFinite(ms)) addedAtById.set(entry.track.id, ms);
  }

  for (const play of inputs.history) {
    const at = Date.parse(play.playedAt);
    if (!Number.isFinite(at)) continue;
    const days = Math.max(0, (nowMs - at) / 86_400_000);
    const weight = Math.exp(-days / 21);
    playedTrackIds.add(play.track.id);
    bumpAffinity(artistScore, genreScore, play.track, weight);
  }
  for (const liked of inputs.liked) {
    bumpAffinity(artistScore, genreScore, liked, BONUS_CURTIDA);
  }

  const scored = inputs.albums
    .map((album) => {
      let affinitySum = 0;
      let recentHits = 0;
      let unplayed = 0;
      let newestAdded = 0;
      for (const t of album.tracks) {
        const a = artistScore.get(norm(t.artists[0]?.name?.trim() ?? '')) ?? 0;
        const g = t.genre ? (genreScore.get(t.genre.toLowerCase()) ?? 0) : 0;
        const liked = likedIds.has(t.id) ? 1.8 : 0;
        const played = playedTrackIds.has(t.id);
        if (!played) unplayed += 1;
        if (recentTrackIds.has(t.id)) recentHits += 1;
        const addedAt = addedAtById.get(t.id) ?? 0;
        if (addedAt > newestAdded) newestAdded = addedAt;
        affinitySum += a + g * 0.45 + liked + (played ? 0 : 0.35);
      }
      const base = affinitySum / Math.max(1, album.tracks.length);
      const daysSinceNewest =
        newestAdded > 0 ? Math.max(0, (nowMs - newestAdded) / 86_400_000) : 999;
      const freshnessBoost = 1 + Math.exp(-daysSinceNewest / 45) * 0.25;
      const discoveryBoost =
        unplayed > 0 ? 1 + Math.min(0.35, (unplayed / Math.max(1, album.tracks.length)) * 0.35) : 1;
      const repeatPenalty =
        recentHits > 0
          ? Math.max(0.25, 1 - (recentHits / Math.max(1, album.tracks.length)) * 0.8)
          : 1;
      const hardRepeatPenalty = recentHits >= Math.ceil(album.tracks.length * 0.7) ? 0.4 : 1;
      const dayFreshness = 0.92 + frescorDoDia(`album:${album.key}`, seed) * 0.16;
      return {
        album,
        score:
          base * freshnessBoost * discoveryBoost * repeatPenalty * hardRepeatPenalty * dayFreshness,
      };
    })
    .filter((row) => row.score > 0.15)
    .sort((a, b) => b.score - a.score);

  const out: LocalAlbum[] = [];
  const artistCap = new Map<string, number>();
  for (const row of scored) {
    const artistKey = albumArtistKey(row.album);
    const used = artistCap.get(artistKey) ?? 0;
    if (used >= 2) continue;
    artistCap.set(artistKey, used + 1);
    out.push(row.album);
    if (out.length >= 12) break;
  }
  return out;
}

/** Cold start / rede de segurança: mixes simples por gênero e artista. */
function fallbackMixes(
  genreIdx: Map<string, GenreBucket>,
  artistIdx: Map<string, ArtistBucket>,
): Recommendation[] {
  const out: Recommendation[] = [];
  const genres = [...genreIdx.values()].sort((a, b) => b.tracks.length - a.tracks.length);
  for (const g of genres.slice(0, 4)) {
    if (g.tracks.length < 3) continue;
    out.push({
      key: `genre:${g.name}`,
      title: `Mix ${g.name}`,
      subtitle: comArtistas(g.tracks),
      coverUrl: primeiraCapa(g.tracks),
      coverUrls: capasDoMix(g.tracks),
      tracks: g.tracks,
    });
  }
  const artists = [...artistIdx.values()].sort((a, b) => b.tracks.length - a.tracks.length);
  for (const a of artists.slice(0, 6)) {
    if (a.tracks.length < 2) continue;
    out.push({
      key: `artist:${a.name}`,
      title: `Mix de ${a.name}`,
      subtitle: comArtistas(a.tracks),
      coverUrl: primeiraCapa(a.tracks),
      coverUrls: capasDoMix(a.tracks),
      tracks: a.tracks,
    });
  }

  // Biblioteca só de singles de artistas distintos (ou sem gênero atribuído)
  // não atinge nenhum dos limiares acima e a prateleira SUMIA — quem tem música
  // sempre merece ao menos um mix.
  if (out.length === 0) {
    const all = [...genreIdx.values()].flatMap((g) => g.tracks);
    const tracks = all.length > 0 ? all : [...artistIdx.values()].flatMap((a) => a.tracks);
    if (tracks.length > 0) {
      out.push({
        key: 'reco:library',
        title: 'Da sua biblioteca',
        subtitle: comArtistas(tracks),
        coverUrl: primeiraCapa(tracks),
        coverUrls: capasDoMix(tracks),
        tracks,
      });
    }
  }
  return out.slice(0, 10);
}

// ── memoização do caminho padrão ────────────────────────────────
// A Home chama a cada render; o resultado só muda quando a biblioteca muda
// (nova referência de list()), o histórico cresce ou o dia vira.
let memoKey: { entries: unknown; day: number; historyLen: number; likedCount: number } | null =
  null;
let memoResult: Recommendation[] = [];
let memoAlbumsKey: {
  entries: unknown;
  albums: unknown;
  day: number;
  historyLen: number;
  likedCount: number;
} | null = null;
let memoAlbumsResult: LocalAlbum[] = [];

/**
 * Prateleiras de recomendação para a Home. Sem argumentos lê os módulos locais
 * (memoizado); com `inputs` é uma função PURA — ideal para testes.
 */
export function buildRecommendations(inputs?: RecoInputs): Recommendation[] {
  if (inputs) return compute(inputs);
  const entries = localLibrary.list();
  // Gosto é DA CONTA: num aparelho compartilhado, usar o histórico do device
  // faria a recomendação de um usuário nascer dos plays de outro.
  const history = localHistory.listForCurrentUser();
  const now = new Date();
  const day = daySeed(now);
  // O like é o sinal de gosto MAIS forte (peso ×3) — ficar fora da chave fazia
  // curtir/descurtir não mexer em nada até a biblioteca ou o dia mudarem.
  const likedCount = localLikes.count();
  if (
    memoKey &&
    memoKey.entries === entries &&
    memoKey.day === day &&
    memoKey.historyLen === history.length &&
    memoKey.likedCount === likedCount
  ) {
    return memoResult;
  }
  memoResult = compute({ entries, history, liked: localLikes.list(), now });
  memoKey = { entries, day, historyLen: history.length, likedCount };
  return memoResult;
}

export function buildAlbumRecommendations(inputs?: AlbumRecoInputs): LocalAlbum[] {
  if (inputs) return computeAlbumRecommendations(inputs);
  const entries = localLibrary.list();
  const albums = localLibrary.albumGroups();
  const history = localHistory.listForCurrentUser();
  const liked = localLikes.list();
  const now = new Date();
  const day = daySeed(now);
  const likedCount = liked.length;
  if (
    memoAlbumsKey &&
    memoAlbumsKey.entries === entries &&
    memoAlbumsKey.albums === albums &&
    memoAlbumsKey.day === day &&
    memoAlbumsKey.historyLen === history.length &&
    memoAlbumsKey.likedCount === likedCount
  ) {
    return memoAlbumsResult;
  }
  memoAlbumsResult = computeAlbumRecommendations({ entries, albums, history, liked, now });
  memoAlbumsKey = { entries, albums, day, historyLen: history.length, likedCount };
  return memoAlbumsResult;
}
