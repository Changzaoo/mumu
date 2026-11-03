/**
 * Lyrics — time-synced ("karaoke") lyrics from LRCLIB (free, no key, CORS-open).
 *
 * We look a track up by title/artist/(duration), parse the LRC timestamps into
 * lines, and cache the result in localStorage so downloaded songs keep their
 * lyrics offline. `previewOnly` (30s Apple) tracks search by name only, since
 * their duration won't match the full song.
 */
import {
  escolherLinhaDoLrclib,
  limparTituloDaLetra,
  linhaDoLrclibBate,
  lrcSemTempo,
  normalizarParaComparar,
  parseLrc as parseLrcCompartilhado,
  type LrclibRow,
  type TrackDto,
} from '@radinho/shared';
import { aiCleanSongTitle } from '@/lib/ai/ai';
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';
import { circuitoAberto } from '@/lib/local/saudeDoImportador';
import { pedirAoLrclib } from './portaoDoLrclib';
import { semCabecalhos } from './cabecalhos';
import { buscarOutraFonte } from './outraFonte';

export type { LrclibRow };

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
  /** Já reancorada no áudio do cofre (ver lib/lyrics/recalibrar) — não refaz. */
  calibrada?: boolean;
  /**
   * CARIMBADA: o áudio confirmou que é esta letra e o relógio é este
   * (alinhamento com confiança alta, ou a voz confirmou). Nunca mais volta ao
   * retrabalho — nem por metadado corrigido. Ver calibragem.ts.
   */
  selada?: boolean;
}

interface CachedLyricsEntry {
  /**
   * `null` = JÁ PROCURAMOS E NÃO EXISTE. Sem isso, toda vez que uma faixa sem
   * letra tocava o app refazia a busca inteira — doze idas ao LRCLIB e ainda
   * uma chamada de IA —, e o resultado era o mesmo nada de sempre.
   */
  lyrics: Lyrics | null;
  /** Entrada negativa que nasceu de uma letra RECUSADA pela voz (ver recusarLetra). */
  recusadaPelaVoz?: boolean;
  /**
   * Fingerprint da faixa usada para buscar essa letra.
   * Quando título/artista mudam (ex.: metadado corrigido), uma letra antiga
   * pode virar incorreta e precisa ser recarregada.
   */
  fingerprint: string;
  /** Quando a busca voltou vazia. Só existe em entrada NEGATIVA. */
  vazioEm?: number;
  /**
   * Quando a letra (entrada POSITIVA) foi buscada. Sem isto a letra em cache
   * valia para sempre: a versão corrigida no LRCLIB nunca chegava. Ausente =
   * entrada antiga, revalidada uma vez.
   */
  buscadaEm?: number;
}

const CACHE_KEY = 'aurial:lyrics-cache';

/** LRC → linhas (ver packages/shared/src/letra/lrc.ts: offset, multi-tempo, A2). */
function parseLrc(lrc: string): LyricLine[] {
  return parseLrcCompartilhado(lrc);
}

/** Normalização de comparação, em qualquer alfabeto (packages/shared/src/letra). */
const normLoose = normalizarParaComparar;

/**
 * True quando uma linha do LRCLIB É mesmo esta faixa — a prova mínima mora em
 * packages/shared/src/letra/aceitacao.ts (o script Node usa a mesma): título,
 * marca de versão, artista e duração; falta de prova é reprovação, e sem a
 * duração confirmando o título limpo tem de ser IGUAL.
 */
export function rowMatches(
  row: LrclibRow,
  title: string,
  names: string[],
  durationSec: number,
): boolean {
  return linhaDoLrclibBate(row, title, names, durationSec);
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
export function toLyrics(row: LrclibRow | null | undefined, semTempo = false): Lyrics | null {
  if (!row) return null;
  // `semTempo` (preview de 30s): os timestamps do LRC são da música INTEIRA e
  // sobre um clipe seriam desincronia garantida. A letra vale, o tempo não —
  // cai para texto puro (o próprio LRC sem as marcas, se não houver plain).
  if (semTempo && !row.plainLyrics?.trim() && row.syncedLyrics?.trim()) {
    const texto = lrcSemTempo(row.syncedLyrics);
    return texto.length > 0
      ? soALetra({ synced: false, lines: texto.map((text) => ({ timeMs: 0, text })), source: null })
      : null;
  }
  if (!semTempo && typeof row.syncedLyrics === 'string' && row.syncedLyrics.trim()) {
    const lines = parseLrc(row.syncedLyrics);
    if (lines.length > 0) return soALetra({ synced: true, lines, source: null });
  }
  if (typeof row.plainLyrics === 'string' && row.plainLyrics.trim()) {
    const lines = row.plainLyrics.split(/\r?\n/).map((text) => ({ timeMs: 0, text: text.trim() }));
    return soALetra({ synced: false, lines, source: null });
  }
  return null;
}

/**
 * SÓ A LETRA: `[Letra de "Mundo Fashion" ft. Matuê]`, `[Intro: Tz da Coronel]`,
 * `[Refrão]`… são metadado do provedor, não verso (ver lib/lyrics/cabecalhos).
 * Saem aqui, antes de a letra ir para o cache, para a tela e para o alinhamento.
 * Letra que só tinha cabeçalho não é letra.
 */
function soALetra(letra: Lyrics): Lyrics | null {
  const limpa = semCabecalhos(letra);
  return limpa.lines.some((l) => l.text.trim()) ? limpa : null;
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

/**
 * A letra de uma entrada do cache, ou null se a entrada não presta. O armazenamento
 * é só um JSON no localStorage: uma entrada nula, um texto solto ou uma letra sem
 * `lines` (gravada por versão antiga, editada à mão, cortada pela cota) fazia o
 * operador `in` lançar e derrubava a tela da letra e a busca por trecho inteiras.
 */
function letraDaEntrada(cached: unknown): Lyrics | null {
  if (!cached || typeof cached !== 'object') return null;
  const letra = 'lyrics' in cached ? (cached as CachedLyricsEntry).lyrics : (cached as Lyrics);
  return letra && typeof letra === 'object' && Array.isArray(letra.lines) ? letra : null;
}

export function cachedLyrics(trackId: string): Lyrics | null {
  return letraDaEntrada(readCache()[trackId]);
}

/**
 * A letra em cache DESTA faixa como ela é hoje — ou null quando o cache foi
 * buscado para outro título/artista/duração.
 *
 * `cachedLyrics` (por id) não olha o fingerprint, e era ela que a tela da
 * letra, o prefetch e a calibração usavam: a faixa ganhava o artista certo na
 * curadoria e continuava mostrando a letra buscada com o artista errado, para
 * sempre, porque `fetchLyrics` (que confere o fingerprint) nunca mais era
 * chamada. Quem tem a faixa em mãos pergunta por aqui.
 */
export function cachedLyricsFor(track: TrackDto): Lyrics | null {
  const guardada = readCache()[track.id];
  if (!guardada || typeof guardada !== 'object') return null;
  const letra = letraDaEntrada(guardada);
  // Letra carimbada vale pelo ÁUDIO, não pelo título: metadado corrigido não a derruba.
  if (letra?.selada) return letra;
  if ('lyrics' in guardada) {
    const entrada = guardada as CachedLyricsEntry;
    if (entrada.fingerprint && entrada.fingerprint !== trackFingerprint(track)) return null;
  }
  return letra;
}

/**
 * A VOZ DISSE QUE NÃO É ESTA LETRA: o alinhamento ficou fraco e a transcrição
 * do áudio quase não contém as palavras dela. Vira entrada negativa (com o
 * prazo de `VALIDADE_DO_VAZIO_MS`, como "procuramos e não existe"): a tela
 * para de mostrar letra de outra música, e a busca é refeita em uma semana —
 * o LRCLIB ganha versões novas todo dia.
 */
/** A entrada em cache desta faixa é a recusa da voz (ver recusarLetra)? */
export function letraRecusadaPelaVoz(track: TrackDto): boolean {
  const guardada = readCache()[track.id];
  if (!guardada || typeof guardada !== 'object' || !('lyrics' in guardada)) return false;
  const entrada = guardada as CachedLyricsEntry;
  return entrada.lyrics === null && entrada.recusadaPelaVoz === true;
}

export function recusarLetra(track: TrackDto): void {
  writeCache({
    ...readCache(),
    [track.id]: {
      lyrics: null,
      fingerprint: trackFingerprint(track),
      vazioEm: Date.now(),
      recusadaPelaVoz: true,
    } satisfies CachedLyricsEntry,
  });
}

/**
 * Grava (ou substitui) a letra de uma faixa no cache — usado quando ganhamos
 * uma versão MELHOR da mesma letra, como a sincronizada a partir do áudio.
 */
/**
 * A letra de uma faixa passou por aqui: o filtro de idade a julga já (import
 * dinâmico — o filtro depende da biblioteca, que depende daqui).
 */
function julgarConteudo(trackId: string, titulo: string, lyrics: Lyrics | null): void {
  if (!lyrics || lyrics.lines.length === 0) return;
  const texto = lyrics.lines.map((l) => l.text).join(String.fromCharCode(10));
  void import('@/lib/conteudo/faixaEtaria')
    .then((m) => m.registrarLetra(trackId, titulo, texto))
    .catch(() => undefined);
}

export function writeLyrics(trackId: string, lyrics: Lyrics, track?: TrackDto): void {
  julgarConteudo(trackId, '', lyrics);
  const current = readCache()[trackId];
  const entrada = current && typeof current === 'object' && 'lyrics' in current ? current : null;
  // Com a faixa em mãos, o fingerprint é o DELA: sem isto a letra calibrada de
  // uma faixa sem entrada no cache era gravada sem fingerprint (formato legado)
  // e a próxima busca online a jogava fora.
  const fingerprint = track ? trackFingerprint(track) : (entrada?.fingerprint ?? '');
  writeCache({
    ...readCache(),
    [trackId]: fingerprint
      ? ({
          lyrics,
          fingerprint,
          buscadaEm: entrada?.buscadaEm ?? Date.now(),
        } satisfies CachedLyricsEntry)
      : lyrics,
  });
}

/** Todas as letras em cache — combustível da busca por trecho de letra. */
export function lyricsCacheEntries(): Array<[string, Lyrics]> {
  const saida: Array<[string, Lyrics]> = [];
  for (const [trackId, cached] of Object.entries(readCache())) {
    const letra = letraDaEntrada(cached);
    // As entradas negativas ("procuramos e não existe") não são letra nenhuma:
    // deixá-las passar aqui quebraria a busca por trecho.
    if (letra) saida.push([trackId, letra]);
  }
  return saida;
}

// ── fetch ───────────────────────────────────────────────────────

/** Strip parentheticals / feat / live-remaster noise that hurts LRCLIB matching. */
const cleanTitleForLyrics = limparTituloDaLetra;

/**
 * `falhou` vira true quando uma ida à fonte ERROU (rede caiu, timeout, 5xx, JSON
 * quebrado) em vez de responder "não tenho". Quem chama não pode gravar "sem
 * letra" por uma semana com base numa resposta que nem chegou.
 */
async function lrclibGet(
  track: TrackDto,
  estado: { falhou: boolean } = { falhou: false },
): Promise<Lyrics | null> {
  const rawTitle = track.title.trim();
  const cleanTitle = cleanTitleForLyrics(rawTitle) || rawTitle;
  // Duração negativa/NaN conta como desconhecida: /api/get só é seguro COM duração.
  const durationSec = track.previewOnly
    ? 0
    : Math.max(0, Math.round((track.durationMs || 0) / 1000));

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

  const escolher = (
    achados: Array<Lyrics | null>,
  ): { synced: Lyrics | null; plain: Lyrics | null } => {
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
    // `/api/get` EXIGE `artist_name`: sem ele o LRCLIB responde 400 (medido em
    // 27/10/2026), e cada 400 contava como "a fonte errou". O candidato sem
    // artista continua valendo na busca solta, onde é aceito.
    if (!artist) return null;
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', title);
    url.searchParams.set('artist_name', artist);
    if (track.album?.title) url.searchParams.set('album_name', track.album.title);
    url.searchParams.set('duration', String(durationSec));
    const res = await pedirAoLrclib(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res) {
      estado.falhou = true; // LRCLIB em pausa (lotado): o pedido nem saiu
      return null;
    }
    if (!res.ok) {
      if (res.status !== 404) estado.falhou = true; // 404 = "não tenho", o resto = erro
      return null;
    }
    const row = (await res.json()) as LrclibRow | null;
    if (!row || typeof row !== 'object') return null; // corpo vazio: "não tenho"
    // /api/get também pode devolver "melhor chute" errado; só aceita quando a
    // linha realmente bate com título/artista/duração da faixa.
    if (!rowMatches(row, title, names, durationSec)) return null;
    return toLyrics(row);
  };

  // Exact get() across title × artist candidates — prefer a synced hit.
  const exatos = escolher(
    await Promise.all(
      combinacoes.map(({ title, artist }) =>
        get(title, artist).catch(() => {
          estado.falhou = true;
          return null;
        }),
      ),
    ),
  );
  if (exatos.synced) return exatos.synced;
  let plainFallback: Lyrics | null = exatos.plain;

  // Fuzzy search — pick the best SYNCED row (compare title + any artist).
  const search = async (title: string, artist: string | undefined): Promise<Lyrics | null> => {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    const res = await pedirAoLrclib(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res?.ok) {
      estado.falhou = true;
      return null;
    }
    const rows = (await res.json()) as LrclibRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // Só aceita uma linha que REALMENTE bate com a faixa (título+artista+
    // duração) — a busca é full-text solta e devolve músicas alheias.
    // Entre as que batem: com tempo primeiro, depois a duração mais perto.
    const melhor = escolherLinhaDoLrclib(rows, title, names, durationSec);
    return melhor ? toLyrics(melhor, track.previewOnly) : null;
  };

  const soltos = escolher(
    await Promise.all(
      combinacoes.map(({ title, artist }) =>
        search(title, artist).catch(() => {
          estado.falhou = true;
          return null;
        }),
      ),
    ),
  );
  if (soltos.synced) return soltos.synced;
  plainFallback ??= soltos.plain;

  return plainFallback;
}

/**
 * TODAS AS LETRAS COM ESTE TÍTULO, de qualquer artista e qualquer duração.
 *
 * Solto de propósito: é o material para `confirmarPelaVoz`, que só aceita uma
 * delas depois de comparar o texto com o que o importador OUVIU no áudio. Sem
 * essa prova, título igual não vale nada ("Lembrei de Você" ≠ "Lembrei de Tu").
 * Existe porque a mesma música aparece no LRCLIB com o artista escrito de outro
 * jeito ("Men0" em vez de "MC Meno K") e em versões de outra duração, e o
 * casamento estrito de `rowMatches` descarta todas — a faixa ficava sem letra
 * e a tela mostrava a transcrição, que erra com autotune.
 */
export async function letrasComOMesmoTitulo(track: TrackDto): Promise<LrclibRow[]> {
  const rawTitle = track.title.trim();
  if (!rawTitle) return [];
  const titulos = Array.from(new Set([cleanTitleForLyrics(rawTitle) || rawTitle, rawTitle]));
  const vistos = new Set<number | string>();
  const saida: LrclibRow[] = [];
  const respostas = await Promise.all(
    titulos.map(async (titulo) => {
      const url = new URL('https://lrclib.net/api/search');
      url.searchParams.set('track_name', titulo);
      const res = await pedirAoLrclib(url.toString(), {
        headers: { Accept: 'application/json' },
      }).catch(() => null);
      if (!res?.ok) return [];
      const rows = (await res.json().catch(() => [])) as unknown;
      return Array.isArray(rows) ? (rows as LrclibRow[]) : [];
    }),
  );
  const qt = titulos.map(normLoose).filter(Boolean);
  for (const row of respostas.flat()) {
    const rt = normLoose(row.trackName ?? '');
    if (!rt || !qt.some((t) => rt === t || rt.includes(t) || t.includes(rt))) continue;
    const chave = row.id ?? `${row.artistName}|${row.trackName}|${row.duration}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(row);
  }
  return saida;
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
 * Quanto vale uma letra ACHADA (não calibrada) antes de ser conferida de novo
 * no LRCLIB. Antes era para sempre. A conferência não apaga: se a busca nova
 * não achar nada (ou errar), a letra de antes fica.
 */
export const VALIDADE_DA_LETRA_MS = 30 * 24 * 3600_000;

/**
 * PLANO B quando o LRCLIB não tem versão COM TEMPO — pergunta ao importador
 * por outras fontes (NetEase, lyrics.ovh; ver apps/importer/outrasFontesDeLetra.mjs).
 * O navegador não alcança essas fontes sozinho (exigem `Referer`/driblam CORS),
 * então quem busca é o importador; aqui só convertemos a resposta para o
 * mesmo formato de `Lyrics` que o resto do app já entende.
 *
 * Preview de 30s (Apple) fica de fora: os únicos timestamps que essas fontes
 * têm são da música INTEIRA, e aplicá-los a um clipe de 30s é desincronia
 * garantida — o mesmo motivo que já faz `lrclibGet` zerar a duração aqui.
 */
async function outrasFontesDeLetra(
  track: TrackDto,
  estado: { falhou: boolean } = { falhou: false },
): Promise<Lyrics | null> {
  if (track.previewOnly) return null;
  const rawTitle = track.title.trim();
  if (!rawTitle) return null;
  const title = cleanTitleForLyrics(rawTitle) || rawTitle;
  const artist = track.artists.find((a) => a.name && a.name !== 'Desconhecido')?.name;
  const durationSec = Math.round((track.durationMs || 0) / 1000);
  // 429/5xx/rede do importador NÃO é "nenhuma fonte tinha": marca a falha, e
  // quem chama não grava "sem letra" por uma semana (auditoria 03/11, 5.2).
  const resposta = await buscarOutraFonte(title, artist, durationSec).catch(() => ({
    achado: null,
    falhou: true,
  }));
  if (resposta.falhou) estado.falhou = true;
  const achado = resposta.achado;
  if (!achado) return null;
  if (achado.synced && achado.lrc) {
    const lines = parseLrc(achado.lrc);
    return lines.length > 0 ? soALetra({ synced: true, lines, source: null }) : null;
  }
  if (!achado.synced && achado.plain) {
    const lines = achado.plain
      .split(/\r?\n/)
      .map((text) => ({ timeMs: 0, text: text.trim() }))
      .filter((l) => l.text);
    return lines.length > 0 ? soALetra({ synced: false, lines, source: null }) : null;
  }
  return null;
}

/**
 * Resolve lyrics for a track: cache → LRCLIB → outras fontes. Never throws;
 * returns null when nothing is found. Successful results are cached for
 * offline reuse.
 *
 * ORDEM DE PREFERÊNCIA (a mais confiável primeiro): LRCLIB com tempo > outra
 * fonte com tempo > LRCLIB texto puro > outra fonte texto puro. O LRCLIB é
 * curado e já passou pela checagem estrita de `rowMatches`; as outras fontes
 * só entram quando o LRCLIB não deu uma versão com tempo, e mesmo assim nunca
 * derrubam um texto puro que o LRCLIB já tinha — texto puro por texto puro, o
 * mais verificado fica.
 */
/**
 * UMA BUSCA POR FAIXA DE CADA VEZ. A pré-busca do player (ao entrar na fila) e
 * a consulta da tela da letra pedem a mesma faixa no mesmo segundo; sem isto
 * eram duas idas ao LRCLIB e a tela esperava a dela em vez de aproveitar a que
 * já estava a caminho. Quem chega enquanto a busca está em voo recebe a mesma
 * promessa. A chave leva o fingerprint: metadado corrigido no meio é outra busca.
 */
const emVoo = new Map<string, Promise<Lyrics | null>>();

export function fetchLyrics(track: TrackDto): Promise<Lyrics | null> {
  const chave = `${track.id}|${trackFingerprint(track)}`;
  const viva = emVoo.get(chave);
  if (viva) return viva;
  const busca = buscarLetra(track).finally(() => emVoo.delete(chave));
  emVoo.set(chave, busca);
  return busca;
}

async function buscarLetra(track: TrackDto): Promise<Lyrics | null> {
  const fingerprint = trackFingerprint(track);
  const guardada = readCache()[track.id];
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  // Entrada que não é objeto (cache sujo) conta como ausente — `in` lançaria.
  const rawCached = guardada && typeof guardada === 'object' ? guardada : undefined;
  /** Letra que já estava aqui e vale como reserva se a revalidação não achar nada. */
  let reserva: Lyrics | null = null;
  if (rawCached) {
    if ('lyrics' in rawCached) {
      const letra = letraDaEntrada(rawCached);
      // CARIMBADA vale pelo áudio, não pelo título: nem metadado corrigido a derruba.
      if (letra?.selada) return letra;
      if (rawCached.fingerprint === fingerprint) {
        // Entrada NEGATIVA ainda no prazo: nada de rede. É o que impede uma
        // faixa sem letra de refazer a busca inteira a cada reprodução.
        if (rawCached.lyrics === null) {
          const vazioEm = rawCached.vazioEm ?? 0;
          if (offline || Date.now() - vazioEm < VALIDADE_DO_VAZIO_MS) return null;
        } else if (letra) {
          julgarConteudo(track.id, track.title ?? '', letra);
          // POSITIVA TAMBÉM VENCE: a letra do LRCLIB é corrigida (tempo,
          // texto) e a correção nunca chegava. Letra calibrada no áudio não
          // vence — o relógio dela veio daqui, não do LRCLIB.
          if (letra.calibrada || offline) return letra;
          if (rawCached.buscadaEm === undefined) {
            // Entrada de antes desta regra: começa a contar agora.
            writeCache({ ...readCache(), [track.id]: { ...rawCached, buscadaEm: Date.now() } });
            return letra;
          }
          if (Date.now() - rawCached.buscadaEm < VALIDADE_DA_LETRA_MS) return letra;
          reserva = letra;
        }
      } else if (offline) {
        // Sem rede e a letra guardada é de OUTRO título/artista: mostrar a
        // antiga seria mostrar letra de outra música. Melhor nada.
        return null;
      }
    } else {
      // Cache legado (sem fingerprint): tenta renovar quando online para evitar
      // manter letra de música errada após correção de metadados.
      if (offline) return letraDaEntrada(rawCached);
    }
  }
  if (!track.title?.trim()) return null;
  try {
    const estado = { falhou: false };
    let lyrics = await lrclibGet(track, estado);
    // Fallback: let the AI parse a clean artist/title and retry once.
    if (!lyrics) {
      const cleaned = await aiCleanSongTitle(track.title, track.artists[0]?.name);
      if (cleaned && (cleaned.title !== track.title || cleaned.artist)) {
        const a0 = track.artists[0];
        lyrics = await lrclibGet(
          {
            ...track,
            title: cleaned.title,
            artists: cleaned.artist
              ? [{ id: a0?.id ?? 'ai', name: cleaned.artist, slug: a0?.slug ?? '', imageUrl: null }]
              : track.artists,
          },
          estado,
        );
      }
    }
    // LRCLIB não devolveu versão COM TEMPO (nada, ou só texto puro): tenta o
    // plano B antes de aceitar o que tem. Uma fonte com tempo troca um texto
    // puro OU um vazio; uma fonte de texto puro só entra quando não havia
    // NADA do LRCLIB — ver a ordem de preferência acima.
    if (!lyrics || !lyrics.synced) {
      const outra = await outrasFontesDeLetra(track, estado);
      if (outra?.synced) lyrics = outra;
      else if (!lyrics) lyrics = outra;
    }
    // A fonte ERROU e não achou nada: não é "sem letra". Gravar a entrada
    // negativa aqui trancaria a faixa por uma semana por causa de um soluço de
    // rede — melhor perguntar de novo na próxima reprodução.
    // O mesmo vale com o importador dado como fora pelo médico: as outras
    // fontes nem foram perguntadas.
    if (!lyrics && (estado.falhou || circuitoAberto())) return reserva;
    // Revalidação que não achou nada: a letra de antes continua (o prazo recomeça).
    if (!lyrics && reserva) lyrics = reserva;
    julgarConteudo(track.id, track.title ?? '', lyrics);
    writeCache({
      ...readCache(),
      [track.id]: lyrics
        ? ({ lyrics, fingerprint, buscadaEm: Date.now() } satisfies CachedLyricsEntry)
        : ({ lyrics: null, fingerprint, vazioEm: Date.now() } satisfies CachedLyricsEntry),
    });
    return lyrics;
  } catch {
    return reserva;
  }
}

/** Fire-and-forget prefetch (e.g. at download time) so lyrics are ready offline. */
export function prefetchLyrics(track: TrackDto): void {
  if (cachedLyricsFor(track)) return;
  void fetchLyrics(track).catch(() => undefined);
}
