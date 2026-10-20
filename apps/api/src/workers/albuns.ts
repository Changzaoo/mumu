/**
 * O ÁLBUM DE CADA FAIXA — devolvido pelos catálogos, com prova.
 *
 * Um terço das faixas das contas (1.602 de 4.997) e do acervo (2.182 de
 * 5.970) estava sem álbum em 20/10/2026, e das que tinham álbum, dois terços
 * não tinham o número da faixa. Sem número, a ficha do artista esconde o
 * álbum (um álbum com uma faixa só vira "single" — ver computeAlbumGroups no
 * app). O resultado era o que o dono viu: artistas sem discos e músicas
 * soltas.
 *
 * Aqui a faixa (título + artista + duração) é procurada no Deezer e, na
 * falta, no iTunes. O casamento é ESTRITO e puro (`escolherCandidato`): o
 * título normalizado tem que bater, o artista tem que bater, e a duração —
 * quando as duas existem — é a prova definitiva (±5 s aceita; >20 s de
 * diferença rejeita: é outra gravação, ao vivo ou remix). Entre vários que
 * passam, vence o de duração mais próxima, e em empate o que vem de um DISCO
 * (mais faixas) em vez do single — é o disco que o dono quer ver na ficha.
 *
 * Devolve álbum, número da faixa, disco, total de faixas, ano e capa. Nunca
 * chuta: sem casamento, `null`, e quem chama anota a tentativa (rodízio em
 * curation.worker).
 */
import { limparTitulo } from '@radinho/shared';

export interface FaixaParaAlbum {
  title: string;
  artists: string[];
  durationMs?: number | null;
}

export interface AlbumEncontrado {
  album: string;
  trackNumber: number | null;
  discNumber: number | null;
  trackCount: number | null;
  releaseYear: number | null;
  /** A capa do DISCO. */
  coverUrl: string | null;
  /**
   * A capa PRÓPRIA da música: a arte do single/EP com o nome dela, quando o
   * catálogo tem um. É o que evita dez faixas do mesmo disco com a mesma cara
   * (pedido do dono, 20/10/2026); o álbum fica de reserva.
   */
  capaDoSingle: string | null;
  fonte: 'deezer' | 'itunes';
}

/** Lançamento com o nome da própria faixa (single/EP): a capa é dela. */
export function capaDoSingleEntre(faixa: FaixaParaAlbum, candidatos: Candidato[]): string | null {
  for (const c of candidatos) {
    if (!c.coverUrl || !mesmoTitulo(faixa.title, c.title) || !mesmoArtista(faixa.artists, c.artist))
      continue;
    if (mesmoTitulo(c.album, faixa.title) || (c.trackCount !== null && c.trackCount <= 2))
      return c.coverUrl;
  }
  return null;
}

/** Miniatura do vídeo de origem — única por faixa, sempre existe para o YouTube. */
export function miniaturaDoVideo(sourceUrl: unknown): string | null {
  if (typeof sourceUrl !== 'string') return null;
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
    else if (/(^|\.)youtube\.com$/.test(host)) {
      id =
        u.searchParams.get('v') ?? /^\/(?:embed|shorts|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

/** Um candidato já no formato comum, venha de onde vier. */
export interface Candidato {
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  trackCount: number | null;
  releaseYear: number | null;
  coverUrl: string | null;
  /** Deezer: id da faixa, para completar número/disco com /track/{id}. */
  deezerTrackId?: number;
  deezerAlbumId?: number;
}

const DIACRITICOS = /[̀-ͯ]/g;

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "feat. X", "(ao vivo)", "- remix" não fazem parte do nome registrado. */
function tituloBase(s: string): string {
  return normalizar(
    limparTitulo(s)
      .replace(/\b(feat|ft|featuring|part|participacao)\b.*$/i, ' ')
      .replace(/\b(remix|remaster\w*|version|versao|edit|mix)\b.*$/i, ' '),
  );
}

function mesmoTitulo(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (x && x === y) return true;
  const bx = tituloBase(a);
  const by = tituloBase(b);
  return bx.length >= 3 && bx === by;
}

function mesmoArtista(nossos: string[], deles: string): boolean {
  const d = normalizar(deles);
  if (!d) return false;
  return nossos.some((n) => {
    const x = normalizar(n);
    if (x.length < 2) return false;
    if (x === d) return true;
    // "MC Kevin" ⊂ "MC Kevin, DJ Nenê"; "The Weeknd" ⊂ "Weeknd": só com nome
    // de tamanho honesto, senão "AL" casa com meio catálogo.
    return x.length >= 4 && (d.includes(x) || x.includes(d));
  });
}

/** Diferença de duração aceita como "mesma gravação" e a que rejeita de vez. */
export const DURACAO_ACEITA_MS = 5_000;
export const DURACAO_REJEITA_MS = 20_000;

/**
 * O candidato que é, com prova, esta faixa — ou null. Puro.
 */
export function escolherCandidato(
  faixa: FaixaParaAlbum,
  candidatos: Candidato[],
): Candidato | null {
  const duracao =
    typeof faixa.durationMs === 'number' && faixa.durationMs > 0 ? faixa.durationMs : null;
  const aptos = candidatos.filter((c) => {
    if (!c.album || !mesmoTitulo(faixa.title, c.title) || !mesmoArtista(faixa.artists, c.artist)) {
      return false;
    }
    if (duracao && c.durationMs) {
      const dif = Math.abs(c.durationMs - duracao);
      if (dif > DURACAO_REJEITA_MS) return false;
    }
    return true;
  });
  if (aptos.length === 0) return null;
  const distancia = (c: Candidato): number =>
    duracao && c.durationMs ? Math.abs(c.durationMs - duracao) : DURACAO_ACEITA_MS;
  aptos.sort((a, b) => {
    const da = distancia(a);
    const db = distancia(b);
    // Dentro da margem aceita, duração não desempata: vale o disco maior.
    const pa = da <= DURACAO_ACEITA_MS ? 0 : da;
    const pb = db <= DURACAO_ACEITA_MS ? 0 : db;
    if (pa !== pb) return pa - pb;
    return (b.trackCount ?? 0) - (a.trackCount ?? 0);
  });
  return aptos[0] ?? null;
}

type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface DepsDeAlbum {
  fetch?: Fetch;
  log?: (msg: string) => void;
  /** Pausa entre chamadas (ms) — o iTunes aceita ~20 por minuto. */
  pausaItunesMs?: number;
}

const TIMEOUT_MS = 10_000;

async function json(f: Fetch, url: string): Promise<unknown> {
  const r = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${r.status} em ${new URL(url).hostname}`);
  return r.json();
}

const ano = (data: unknown): number | null => {
  const m = typeof data === 'string' ? /^(\d{4})/.exec(data) : null;
  return m ? Number(m[1]) : null;
};

// ── Deezer ──────────────────────────────────────────────────────────────────

interface DeezerBusca {
  data?: Array<{
    id?: number;
    title?: string;
    duration?: number;
    artist?: { name?: string };
    album?: { id?: number; title?: string; cover_xl?: string; cover_big?: string };
  }>;
}
interface DeezerFaixa {
  track_position?: number;
  disk_number?: number;
  release_date?: string;
  album?: { id?: number; title?: string; cover_xl?: string; cover_big?: string };
}
interface DeezerAlbum {
  nb_tracks?: number;
  release_date?: string;
  record_type?: string;
}

export function candidatosDoDeezer(busca: DeezerBusca): Candidato[] {
  return (busca.data ?? [])
    .filter((r) => r && typeof r.title === 'string' && r.album?.title)
    .map((r) => ({
      title: r.title ?? '',
      artist: r.artist?.name ?? '',
      album: r.album?.title ?? '',
      durationMs: typeof r.duration === 'number' ? r.duration * 1000 : null,
      trackNumber: null,
      discNumber: null,
      trackCount: null,
      releaseYear: null,
      coverUrl: r.album?.cover_xl ?? r.album?.cover_big ?? null,
      deezerTrackId: r.id,
      deezerAlbumId: r.album?.id,
    }));
}

async function noDeezer(faixa: FaixaParaAlbum, f: Fetch): Promise<AlbumEncontrado | null> {
  const artista = faixa.artists[0] ?? '';
  const q = `artist:"${artista.replace(/"/g, '')}" track:"${faixa.title.replace(/"/g, '')}"`;
  const busca = (await json(
    f,
    `https://api.deezer.com/search?limit=10&q=${encodeURIComponent(q)}`,
  )) as DeezerBusca;
  let candidatos = candidatosDoDeezer(busca);
  if (candidatos.length === 0) {
    // Sem o filtro por campo: o Deezer é literal demais com apelido de MC.
    const solta = (await json(
      f,
      `https://api.deezer.com/search?limit=10&q=${encodeURIComponent(`${artista} ${faixa.title}`)}`,
    )) as DeezerBusca;
    candidatos = candidatosDoDeezer(solta);
  }
  const escolhido = escolherCandidato(faixa, candidatos);
  if (!escolhido?.deezerTrackId) return null;
  const capaDoSingle = capaDoSingleEntre(faixa, candidatos);
  const detalhe = (await json(
    f,
    `https://api.deezer.com/track/${escolhido.deezerTrackId}`,
  )) as DeezerFaixa;
  let trackCount: number | null = null;
  let releaseYear = ano(detalhe.release_date);
  const albumId = detalhe.album?.id ?? escolhido.deezerAlbumId;
  if (albumId) {
    try {
      const album = (await json(f, `https://api.deezer.com/album/${albumId}`)) as DeezerAlbum;
      trackCount = typeof album.nb_tracks === 'number' ? album.nb_tracks : null;
      releaseYear ??= ano(album.release_date);
    } catch {
      /* sem o total de faixas: o número ainda vale */
    }
  }
  return {
    album: detalhe.album?.title ?? escolhido.album,
    trackNumber: typeof detalhe.track_position === 'number' ? detalhe.track_position : null,
    discNumber: typeof detalhe.disk_number === 'number' ? detalhe.disk_number : null,
    trackCount,
    releaseYear,
    coverUrl: detalhe.album?.cover_xl ?? detalhe.album?.cover_big ?? escolhido.coverUrl,
    capaDoSingle,
    fonte: 'deezer',
  };
}

// ── iTunes ──────────────────────────────────────────────────────────────────

interface ItunesBusca {
  results?: Array<{
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    trackNumber?: number;
    discNumber?: number;
    trackCount?: number;
    releaseDate?: string;
    artworkUrl100?: string;
    trackTimeMillis?: number;
  }>;
}

export function candidatosDoItunes(busca: ItunesBusca): Candidato[] {
  return (busca.results ?? [])
    .filter((r) => r && typeof r.trackName === 'string' && r.collectionName)
    .map((r) => ({
      title: r.trackName ?? '',
      artist: r.artistName ?? '',
      album: r.collectionName ?? '',
      durationMs: typeof r.trackTimeMillis === 'number' ? r.trackTimeMillis : null,
      trackNumber: typeof r.trackNumber === 'number' ? r.trackNumber : null,
      discNumber: typeof r.discNumber === 'number' ? r.discNumber : null,
      trackCount: typeof r.trackCount === 'number' ? r.trackCount : null,
      releaseYear: ano(r.releaseDate),
      coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace(/\d+x\d+bb/, '600x600bb') : null,
    }));
}

async function noItunes(faixa: FaixaParaAlbum, f: Fetch): Promise<AlbumEncontrado | null> {
  const termo = encodeURIComponent(`${faixa.artists[0] ?? ''} ${faixa.title}`.trim());
  for (const pais of ['BR', 'US']) {
    const busca = (await json(
      f,
      `https://itunes.apple.com/search?media=music&entity=song&limit=25&country=${pais}&term=${termo}`,
    )) as ItunesBusca;
    const candidatos = candidatosDoItunes(busca);
    const escolhido = escolherCandidato(faixa, candidatos);
    if (escolhido) {
      return {
        album: escolhido.album,
        trackNumber: escolhido.trackNumber,
        discNumber: escolhido.discNumber,
        trackCount: escolhido.trackCount,
        releaseYear: escolhido.releaseYear,
        coverUrl: escolhido.coverUrl,
        capaDoSingle: capaDoSingleEntre(faixa, candidatos),
        fonte: 'itunes',
      };
    }
  }
  return null;
}

/**
 * Procura o álbum da faixa: Deezer primeiro (limite generoso, 3 chamadas por
 * faixa), iTunes depois (~20 chamadas por minuto, por isso a pausa). Erros de
 * rede viram `null` com log — a faixa é tentada de novo no rodízio.
 */
export async function procurarAlbum(
  faixa: FaixaParaAlbum,
  deps: DepsDeAlbum = {},
): Promise<AlbumEncontrado | null> {
  const f = deps.fetch ?? (fetch as unknown as Fetch);
  const log = deps.log ?? (() => {});
  if (!faixa.title.trim() || faixa.artists.length === 0) return null;
  try {
    const d = await noDeezer(faixa, f);
    if (d) return d;
  } catch (err) {
    log(`deezer falhou para "${faixa.title}": ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    if (deps.pausaItunesMs) await new Promise((r) => setTimeout(r, deps.pausaItunesMs));
    return await noItunes(faixa, f);
  } catch (err) {
    log(`itunes falhou para "${faixa.title}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
