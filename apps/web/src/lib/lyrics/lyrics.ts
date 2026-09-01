/**
 * Lyrics — time-synced ("karaoke") lyrics from LRCLIB (free, no key, CORS-open).
 *
 * We look a track up by title/artist/(duration), parse the LRC timestamps into
 * lines, and cache the result in localStorage so downloaded songs keep their
 * lyrics offline. `previewOnly` (30s Apple) tracks search by name only, since
 * their duration won't match the full song.
 */
import type { TrackDto } from '@radinho/shared';
import { aiCleanSongTitle } from '@/lib/ai/ai';
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';

export interface LyricLine {
  timeMs: number;
  text: string;
  /**
   * Tempo de cada palavra, quando conhecido (alinhamento forçado ou
   * transcrição). É o que faz o destaque andar JUNTO com a voz em vez de
   * acender a linha inteira e ficar quatro segundos parado nela.
   */
  words?: { text: string; timeMs: number }[];
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string | null;
}

interface CachedLyricsEntry {
  /**
   * `null` = JÁ PROCURAMOS E NÃO EXISTE. Sem isso, toda vez que uma faixa sem
   * letra tocava o app refazia a busca inteira — doze idas ao LRCLIB e ainda
   * uma chamada de IA —, e o resultado era o mesmo nada de sempre.
   */
  lyrics: Lyrics | null;
  /**
   * Fingerprint da faixa usada para buscar essa letra.
   * Quando título/artista mudam (ex.: metadado corrigido), uma letra antiga
   * pode virar incorreta e precisa ser recarregada.
   */
  fingerprint: string;
  /** Quando a busca voltou vazia. Só existe em entrada NEGATIVA. */
  vazioEm?: number;
}

const CACHE_KEY = 'aurial:lyrics-cache';
const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i;

function parseLrc(lrc: string): LyricLine[] {
  // `[offset:±ms]` é um deslocamento global do arquivo; convenção dos players:
  // tempo efetivo = tempo - offset (positivo adianta a letra). Ignorá-lo deixa
  // TODAS as linhas fora de sincronia por esse valor fixo.
  const offset = Number(LRC_OFFSET.exec(lrc)?.[1] ?? 0) || 0;
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    LRC_TIME.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let end = 0;
    while ((match = LRC_TIME.exec(raw)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const frac = match[3] ? Number((match[3] + '000').slice(0, 3)) : 0;
      times.push((min * 60 + sec) * 1000 + frac);
      end = LRC_TIME.lastIndex;
    }
    if (times.length === 0) continue;
    const text = raw.slice(end).trim();
    for (const t of times) out.push({ timeMs: Math.max(0, t - offset), text });
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

export interface LrclibRow {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  duration?: number | null;
}

/**
 * Normalização frouxa para comparar título/artista — EM QUALQUER ALFABETO.
 *
 * A versão anterior terminava em `.replace(/[^a-z0-9]+/g, ' ')`, e essa linha
 * deixava fora do app toda música que não se escreve com o alfabeto latino.
 * Para o português ela só tirava a pontuação; para um título inteiro em
 * coreano, japonês, chinês, russo, grego, árabe, hebraico ou tailandês ela
 * apagava TUDO e devolvia string vazia — e `rowMatches` recusa vazio na
 * primeira linha.
 *
 * O modo de falha era invisível, que é o que o tornava difícil: o LRCLIB
 * ENCONTRAVA a letra certa e devolvia a linha correta; era o nosso próprio
 * guarda que a jogava fora. Sem erro, sem log — a faixa simplesmente nunca
 * ganhava letra, para sempre.
 *
 * `\p{L}` e `\p{N}` guardam letra e número de qualquer escrita, que é o que
 * "letra e número" sempre quis dizer aqui. O passo dos acentos vira `\p{M}`
 * (toda marca combinante, não só o bloco latino) entre NFD e NFC: decompor
 * separa o acento para ele poder cair, e recompor devolve o hangul ao seu
 * silabário — sem o NFC final, 한 voltaria como três jamo soltos.
 *
 * EFEITO COLATERAL ACEITO: isto muda o `trackFingerprint` de faixas com título
 * não-latino, então a letra que estiver em cache para elas será rebuscada uma
 * vez. Ela estava errada ou ausente de qualquer forma.
 */
function normLoose(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when a fuzzy `/api/search` row plausibly IS this track — the search
 * endpoint is loose full-text and returns many unrelated songs, so accepting
 * the first row with synced lyrics is exactly how WRONG lyrics get locked in.
 * Guard on title similarity + artist overlap + duration proximity.
 */
export function rowMatches(
  row: LrclibRow,
  title: string,
  names: string[],
  durationSec: number,
): boolean {
  const rt = normLoose(row.trackName ?? '');
  const qt = normLoose(title);
  if (!rt || !qt) return false;
  // O casamento de título é de propósito FROUXO ("Warzone" casa com "Warzone
  // (Remix)"), e por isso ele sozinho nunca pode bastar — ver a prova mínima
  // no fim desta função.
  const titleOk = rt === qt || rt.includes(qt) || qt.includes(rt);
  if (!titleOk) return false;

  const ra = normLoose(row.artistName ?? '');
  const nomes = names.map(normLoose).filter(Boolean);
  const daParaCompararArtista = ra.length > 0 && nomes.length > 0;
  const artistaBate = daParaCompararArtista && nomes.some((n) => ra.includes(n) || n.includes(ra));
  if (daParaCompararArtista && !artistaBate) return false; // artista conhecido e diferente

  const daParaCompararDuracao = durationSec > 0 && typeof row.duration === 'number';
  const duracaoBate = daParaCompararDuracao && Math.abs((row.duration ?? 0) - durationSec) <= 3;
  if (daParaCompararDuracao && !duracaoBate) return false; // duração conhecida e diferente

  // PROVA MÍNIMA: título parecido NÃO É EVIDÊNCIA.
  //
  // Antes, a ausência de dado contava como aprovação: sem artista conhecido
  // (faixa creditada a "Desconhecido", que a busca descarta) e sem duração na
  // linha, sobrava só o título frouxo — e a letra de outra música entrava e
  // ficava em cache. É o defeito clássico de "a letra não é dessa música", e
  // ele nascia aqui, de um `||` que lia "não sei" como "pode".
  //
  // Agora falta de prova é reprovação: ou o artista bate, ou a duração bate.
  return artistaBate || duracaoBate;
}

/**
 * `source` NÃO NOMEIA O PROVEDOR — é a mesma regra que o resto do app já segue.
 *
 * O app não anuncia de onde vem (nem de onde não vem) o conteúdo: a mensagem de
 * erro da importação já omite a plataforma de propósito, e a caixa de adicionar
 * música fala em "link", não no site. A letra era o último lugar que destoava,
 * carimbando o nome do serviço no rodapé do painel.
 *
 * `null` some da tela: `LyricsView` só desenha o rodapé quando há algo a dizer.
 *
 * O QUE CONTINUA APARECENDO, e por quê: a transcrição automática. Aquilo não é
 * crédito de terceiro, é AVISO DE CONFIANÇA — letra que a máquina ouviu erra, e
 * quem lê precisa saber que está diante de um palpite, não de um texto
 * publicado. Tirar aquele rótulo não removeria uma fonte, removeria uma
 * ressalva.
 */
function toLyrics(row: LrclibRow | null | undefined): Lyrics | null {
  if (!row) return null;
  if (typeof row.syncedLyrics === 'string' && row.syncedLyrics.trim()) {
    const lines = parseLrc(row.syncedLyrics);
    if (lines.length > 0) return { synced: true, lines, source: null };
  }
  if (typeof row.plainLyrics === 'string' && row.plainLyrics.trim()) {
    const lines = row.plainLyrics.split(/\r?\n/).map((text) => ({ timeMs: 0, text: text.trim() }));
    return { synced: false, lines, source: null };
  }
  return null;
}

function trackFingerprint(track: TrackDto): string {
  const title = normLoose(track.title ?? '');
  const artist = normLoose(track.artists[0]?.name ?? '');
  const duration = track.previewOnly ? 0 : Math.round((track.durationMs || 0) / 1000);
  return `${title}|${artist}|${duration}`;
}

// ── offline cache ───────────────────────────────────────────────
// MEMOIZADO: o cache de letras chega a megabytes — fazer JSON.parse a cada
// consulta (a busca por letra roda a cada tecla!) congelaria a página. O parse
// acontece UMA vez; escrever atualiza a memória primeiro.
type LyricsCacheStore = Record<string, Lyrics | CachedLyricsEntry>;
let cacheMem: LyricsCacheStore | null = null;

function readCache(): LyricsCacheStore {
  if (cacheMem) return cacheMem;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cacheMem = parsed && typeof parsed === 'object' ? (parsed as LyricsCacheStore) : {};
  } catch {
    cacheMem = {};
  }
  return cacheMem;
}

/**
 * TETO DO CACHE DE LETRAS — este era o cache que enchia o cofre inteiro.
 *
 * Está escrito aqui em cima que ele "chega a megabytes", e ele crescia SEM
 * LIMITE nenhum, com um `catch {}` mudo. O localStorage tem ~5 MB para o app
 * todo, então em algum momento ele tomava o espaço da biblioteca do usuário (que
 * parava de persistir e sumia na recarga) e o do Firestore (que quebrava o
 * cliente no meio da reprodução — ver lib/local/cofreLocal.ts).
 *
 * 1,5 MB dá conta de centenas de letras sincronizadas e deixa folga de sobra
 * para o resto. Passou do teto, as MAIS ANTIGAS saem: as chaves de um objeto
 * JSON preservam a ordem de inserção, então cortar pela frente é cortar o que
 * foi buscado há mais tempo — e letra descartada volta do LRCLIB na próxima vez
 * que a faixa tocar.
 */
const TETO_LETRAS = 1_500_000;

function podarAntigas(store: LyricsCacheStore): { store: LyricsCacheStore; texto: string } {
  let atual = store;
  let texto = JSON.stringify(atual);
  while (texto.length > TETO_LETRAS) {
    const chaves = Object.keys(atual);
    if (chaves.length <= 1) break; // nada mais a cortar
    // Corta um quarto das mais antigas por vez: reserializar a cada letra
    // removida custaria mais que o próprio despejo.
    const sobrevivem = chaves.slice(Math.max(1, Math.ceil(chaves.length / 4)));
    const podado: LyricsCacheStore = {};
    for (const k of sobrevivem) {
      const v = atual[k];
      if (v) podado[k] = v;
    }
    atual = podado;
    texto = JSON.stringify(atual);
  }
  return { store: atual, texto };
}

function writeCache(next: LyricsCacheStore): void {
  const { store, texto } = podarAntigas(next);
  cacheMem = store;
  gravarCache(CACHE_KEY, texto, TETO_LETRAS);
}

// Sob pressão de cota este é o ÚLTIMO cache a ser sacrificado (prioridade 40):
// é o mais caro de perder — uma letra sincronizada custa uma busca e, quando
// vem do alinhamento por áudio, uma decodificação inteira da faixa.
registrarDescartavel(CACHE_KEY, 40, () => {
  cacheMem = null;
});

export function cachedLyrics(trackId: string): Lyrics | null {
  const cached = readCache()[trackId];
  if (!cached) return null;
  return 'lyrics' in cached ? cached.lyrics : cached;
}

/**
 * Grava (ou substitui) a letra de uma faixa no cache — usado quando ganhamos
 * uma versão MELHOR da mesma letra, como a sincronizada a partir do áudio.
 */
export function writeLyrics(trackId: string, lyrics: Lyrics): void {
  const current = readCache()[trackId];
  const fingerprint = current && 'lyrics' in current ? current.fingerprint : '';
  writeCache({
    ...readCache(),
    [trackId]: fingerprint ? ({ lyrics, fingerprint } satisfies CachedLyricsEntry) : lyrics,
  });
}

/** Todas as letras em cache — combustível da busca por trecho de letra. */
export function lyricsCacheEntries(): Array<[string, Lyrics]> {
  const saida: Array<[string, Lyrics]> = [];
  for (const [trackId, cached] of Object.entries(readCache())) {
    const letra = 'lyrics' in cached ? cached.lyrics : cached;
    // As entradas negativas ("procuramos e não existe") não são letra nenhuma:
    // deixá-las passar aqui quebraria a busca por trecho.
    if (letra) saida.push([trackId, letra]);
  }
  return saida;
}

// ── fetch ───────────────────────────────────────────────────────

/** Strip parentheticals / feat / live-remaster noise that hurts LRCLIB matching. */
function cleanTitleForLyrics(title: string): string {
  return title
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // (feat …), [Official Video]
    .replace(/\s*[-–—]\s*(?:ao\s+vivo|live|remaster(?:ed)?.*|slowed.*|sped\s*up.*)$/i, ' ')
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/i, ' ') // trailing "feat X" without parens
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function lrclibGet(track: TrackDto): Promise<Lyrics | null> {
  const rawTitle = track.title.trim();
  const cleanTitle = cleanTitleForLyrics(rawTitle) || rawTitle;
  const durationSec = track.previewOnly ? 0 : Math.round((track.durationMs || 0) / 1000);

  // Try every distinct artist on the track (a two-artist song matches on either),
  // then no-artist. Distinct, order-preserving, non-empty.
  const names = Array.from(
    new Set(track.artists.map((a) => a.name?.trim()).filter((a): a is string => Boolean(a))),
  )
    .filter((a) => a !== 'Desconhecido')
    .slice(0, 2); // cap tries so we stay polite to LRCLIB
  const artistCandidates: Array<string | undefined> = [...names, undefined];
  const titleCandidates = Array.from(new Set([cleanTitle, rawTitle].filter(Boolean)));

  /**
   * TODAS AS TENTATIVAS DE UMA VEZ, E A ESCOLHA DEPOIS.
   *
   * Estes dois laços eram `await` dentro de `for` dentro de `for`: até seis
   * idas ao LRCLIB uma ESPERANDO A OUTRA, e mais seis na busca solta — doze
   * viagens em fila indiana antes de a letra aparecer. Num celular, com ~400ms
   * cada, isso é a letra levando vários segundos para uma faixa que o servidor
   * já tinha respondido na primeira.
   *
   * O número de pedidos é o MESMO (a lista de candidatos não mudou, e a
   * cortesia com o LRCLIB é a mesma); o que muda é que eles correm juntos e o
   * custo total vira o do mais lento, não a soma de todos.
   *
   * A ORDEM DE PREFERÊNCIA É PRESERVADA, e isso é o que impede a paralelização
   * de virar uma regressão de qualidade: os candidatos vêm ordenados do mais
   * confiável (título limpo + artista principal) para o menos, e a escolha
   * continua percorrendo essa ordem. Aceitar "a primeira resposta que chegar"
   * seria deixar a rede escolher a letra — que é exatamente como letra errada
   * se instala.
   */
  const combinacoes = titleCandidates.flatMap((title) =>
    artistCandidates.map((artist) => ({ title, artist })),
  );

  const escolher = (achados: Array<Lyrics | null>): { synced: Lyrics | null; plain: Lyrics | null } => {
    let synced: Lyrics | null = null;
    let plain: Lyrics | null = null;
    for (const achado of achados) {
      if (!achado) continue;
      if (achado.synced) {
        synced ??= achado;
      } else {
        plain ??= achado;
      }
    }
    return { synced, plain };
  };

  const get = async (title: string, artist: string | undefined): Promise<Lyrics | null> => {
    if (!durationSec) return null;
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    if (track.album?.title) url.searchParams.set('album_name', track.album.title);
    url.searchParams.set('duration', String(durationSec));
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const row = (await res.json()) as LrclibRow;
    // /api/get também pode devolver "melhor chute" errado; só aceita quando a
    // linha realmente bate com título/artista/duração da faixa.
    if (!rowMatches(row, title, names, durationSec)) return null;
    return toLyrics(row);
  };

  // Exact get() across title × artist candidates — prefer a synced hit.
  const exatos = escolher(
    await Promise.all(combinacoes.map(({ title, artist }) => get(title, artist).catch(() => null))),
  );
  if (exatos.synced) return exatos.synced;
  let plainFallback: Lyrics | null = exatos.plain;

  // Fuzzy search — pick the best SYNCED row (compare title + any artist).
  const search = async (title: string, artist: string | undefined): Promise<Lyrics | null> => {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()) as LrclibRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // Só aceita uma linha que REALMENTE bate com a faixa (título+artista+
    // duração) — a busca é full-text solta e devolve músicas alheias.
    const synced = rows.find((r) => r.syncedLyrics && rowMatches(r, title, names, durationSec));
    if (synced) return toLyrics(synced);
    const plain = rows.find((r) => rowMatches(r, title, names, durationSec));
    return plain ? toLyrics(plain) : null;
  };

  const soltos = escolher(
    await Promise.all(
      combinacoes.map(({ title, artist }) => search(title, artist).catch(() => null)),
    ),
  );
  if (soltos.synced) return soltos.synced;
  plainFallback ??= soltos.plain;

  return plainFallback;
}

/**
 * Quanto vale uma resposta "essa faixa não tem letra".
 *
 * Não é para sempre: o LRCLIB é colaborativo e ganha letras novas todo dia.
 * Uma semana é o meio-termo — a faixa que tocou ontem não refaz a busca, e a
 * que ficou meses sem letra volta a ser perguntada.
 */
const VALIDADE_DO_VAZIO_MS = 7 * 24 * 3600_000;

/**
 * Resolve lyrics for a track: cache → LRCLIB. Never throws; returns null when
 * nothing is found. Successful results are cached for offline reuse.
 */
export async function fetchLyrics(track: TrackDto): Promise<Lyrics | null> {
  const fingerprint = trackFingerprint(track);
  const rawCached = readCache()[track.id];
  if (rawCached) {
    if ('lyrics' in rawCached) {
      if (rawCached.fingerprint === fingerprint) {
        // Entrada NEGATIVA ainda no prazo: nada de rede. É o que impede uma
        // faixa sem letra de refazer a busca inteira a cada reprodução.
        if (rawCached.lyrics === null) {
          const vazioEm = rawCached.vazioEm ?? 0;
          if (Date.now() - vazioEm < VALIDADE_DO_VAZIO_MS) return null;
        } else {
          return rawCached.lyrics;
        }
      }
      // Sem rede, usa o cache mesmo antigo em vez de falhar em branco.
      if (typeof navigator !== 'undefined' && !navigator.onLine) return rawCached.lyrics;
    } else {
      // Cache legado (sem fingerprint): tenta renovar quando online para evitar
      // manter letra de música errada após correção de metadados.
      if (typeof navigator !== 'undefined' && !navigator.onLine) return rawCached;
    }
  }
  if (!track.title?.trim()) return null;
  try {
    let lyrics = await lrclibGet(track);
    // Fallback: let the AI parse a clean artist/title and retry once.
    if (!lyrics) {
      const cleaned = await aiCleanSongTitle(track.title, track.artists[0]?.name);
      if (cleaned && (cleaned.title !== track.title || cleaned.artist)) {
        const a0 = track.artists[0];
        lyrics = await lrclibGet({
          ...track,
          title: cleaned.title,
          artists: cleaned.artist
            ? [{ id: a0?.id ?? 'ai', name: cleaned.artist, slug: a0?.slug ?? '', imageUrl: null }]
            : track.artists,
        });
      }
    }
    writeCache({
      ...readCache(),
      [track.id]: lyrics
        ? ({ lyrics, fingerprint } satisfies CachedLyricsEntry)
        : ({ lyrics: null, fingerprint, vazioEm: Date.now() } satisfies CachedLyricsEntry),
    });
    return lyrics;
  } catch {
    return null;
  }
}

/** Fire-and-forget prefetch (e.g. at download time) so lyrics are ready offline. */
export function prefetchLyrics(track: TrackDto): void {
  if (cachedLyrics(track.id)) return;
  void fetchLyrics(track).catch(() => undefined);
}
