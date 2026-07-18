/**
 * O TIME DE METADADOS — 5 agentes, cada um com UMA função. Arquitetura
 * anti-alucinação: quem coleta não decide, quem decide não busca, e nem a IA
 * nem o catálogo podem INVENTAR um artista que a fonte não sustenta.
 *
 *  1. EXTRATOR    — coleta as evidências REAIS da fonte (yt-dlp): artista/
 *                   faixa/álbum estruturados (YouTube Music) + o nome do canal
 *                   do uploader. Para trap/underground autopublicado, o canal
 *                   É a identidade do artista (ex.: "Brandão85").
 *  2. CURADOR     — limpa as evidências: remove " - Topic", "VEVO", emojis e
 *                   ruído de título ("Official Video"…), e descarta canais
 *                   agregadores (playlist/lyrics/records) que NÃO são artistas.
 *  3. VERIFICADOR — consulta o catálogo e só CONFIRMA quando as provas batem
 *                   estritamente. Dois instrumentos: (a) iTunes — título E
 *                   artista precisam bater; (b) a "lente" de álbum (Deezer) —
 *                   identifica o álbum REAL citado pela fonte e só adota o
 *                   artista/capa dele quando a faixa está na tracklist.
 *                   Nunca decide sozinho: sem evidência, ele nem procura.
 *  4. JUIZ        — decide o crédito por precedência de evidência:
 *                   fonte estruturada > "Artista - Título" > canal do uploader
 *                   > crédito atual. O catálogo/IA pode no máximo REFINAR um
 *                   crédito já provado — jamais introduzir um artista novo
 *                   (é isso que transformava "Warzone" do Brandão em The Wanted).
 *  5. AUDITOR     — mora em localLibrary.ts (funções redrive/audit): varre a
 *                   biblioteca em segundo plano usando as regras do JUIZ,
 *                   re-deriva cada faixa da fonte, desfaz créditos sem
 *                   evidência e restaura a capa da fonte quando o crédito
 *                   antigo era alucinado.
 */
import { cleanQuery, identifyByTitle, verifyIdentity, type EnrichedMeta } from '@/lib/local/enrich';
import { fetchAlbumInfo } from '@/lib/local/importerHelper';

// ── evidências e veredito ───────────────────────────────────────────────────

/** Tudo que sabemos DE VERDADE sobre uma faixa, vindo da fonte — nunca de palpite. */
export interface Evidencia {
  /** Artista estruturado da fonte (yt-dlp `artist`/`artists` — YouTube Music). */
  sourceArtist: string | null;
  /** Título estruturado da música na fonte (yt-dlp `track`). */
  sourceTrack: string | null;
  /** Álbum estruturado da fonte (yt-dlp `album`). */
  sourceAlbum: string | null;
  /** Canal/uploader, já limpo pelo CURADOR (null se for canal agregador). */
  uploader: string | null;
  /** Título bruto do vídeo/arquivo. */
  rawTitle: string;
}

export type Procedencia = 'fonte' | 'titulo' | 'uploader' | 'atual' | 'nenhuma';

/** O veredito do JUIZ: crédito + de onde veio a prova. */
export interface Credito {
  title: string;
  artist: string;
  album: string | null;
  procedencia: Procedencia;
}

// ── AGENTE 2 · CURADOR ──────────────────────────────────────────────────────

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

/** Sufixos de canal que não fazem parte do nome do artista. */
const UPLOADER_SUFFIXES = [
  /\s*-\s*topic\s*$/i, // canais auto-gerados do YouTube Music
  /\s*vevo\s*$/i,
  /\s*\(?\s*(oficial|official)\s*\)?\s*$/i,
];

/**
 * Canais agregadores/curadores — reupload de terceiros, playlists, lyric
 * channels, gravadoras genéricas. O nome deles NUNCA vira crédito de artista.
 */
const UPLOADER_AGGREGATOR =
  /\b(playlists?|lyrics?|letras?|legendado|traduç|records|recordings|distro|promo|channel|hits|top\s*\d|mixes|s[oó]\s+as\s+melhores|melhores\s+m[uú]sicas)\b/i;

/**
 * CURADOR: limpa um nome de canal para servir como identidade de artista.
 * Retorna null quando o canal não representa um artista (agregador/vazio).
 */
export function curadorLimpaUploader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.replace(EMOJI, ' ');
  for (const suffix of UPLOADER_SUFFIXES) name = name.replace(suffix, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  if (!name || name.length < 2) return null;
  if (UPLOADER_AGGREGATOR.test(name)) return null;
  return name;
}

// ── AGENTE 1 · EXTRATOR ─────────────────────────────────────────────────────

/**
 * EXTRATOR: consolida os metadados crus da fonte (importer /import ou /meta)
 * numa Evidencia, já passando o uploader pelo CURADOR. Não decide nada.
 */
export function extrator(input: {
  artist?: string | null;
  track?: string | null;
  album?: string | null;
  uploader?: string | null;
  title?: string | null;
}): Evidencia {
  const s = (v?: string | null): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    sourceArtist: s(input.artist),
    sourceTrack: s(input.track),
    sourceAlbum: s(input.album),
    uploader: curadorLimpaUploader(input.uploader),
    rawTitle: input.title?.trim() ?? '',
  };
}

// ── AGENTE 4 · JUIZ ─────────────────────────────────────────────────────────

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * JUIZ: decide o crédito de uma faixa por precedência de evidência. Nunca
 * consulta catálogo nem IA — só olha o que a fonte prova:
 *   1. artista estruturado da fonte (YouTube Music) — a verdade absoluta;
 *   2. título "Artista - Título" (curado);
 *   3. canal do uploader (curado) — melhor "Brandão85" que "Desconhecido";
 *   4. crédito atual (se já existia um);
 *   5. "Desconhecido" — a única resposta honesta sem evidência.
 */
export function juizDecideCredito(ev: Evidencia, atual?: { artist?: string | null }): Credito {
  const parsed = ev.rawTitle ? cleanQuery(ev.rawTitle) : { title: '' };
  const title = ev.sourceTrack || parsed.title || ev.rawTitle;
  if (ev.sourceArtist) {
    return { title, artist: ev.sourceArtist, album: ev.sourceAlbum, procedencia: 'fonte' };
  }
  if (parsed.artist) {
    return { title, artist: parsed.artist, album: ev.sourceAlbum, procedencia: 'titulo' };
  }
  if (ev.uploader) {
    return { title, artist: ev.uploader, album: ev.sourceAlbum, procedencia: 'uploader' };
  }
  const atualNome = atual?.artist?.trim();
  if (atualNome && atualNome !== 'Desconhecido') {
    return { title, artist: atualNome, album: ev.sourceAlbum, procedencia: 'atual' };
  }
  return { title, artist: 'Desconhecido', album: ev.sourceAlbum, procedencia: 'nenhuma' };
}

/**
 * JUIZ: o crédito atual conflita com a evidência da fonte? Verdadeiro quando a
 * fonte tem evidência de artista e o nome creditado não aparece em NENHUMA
 * delas (nem no título bruto) — sinal de crédito alucinado por catálogo/IA
 * (ex.: "Warzone" creditada a The Wanted num vídeo do canal Brandão85).
 * Nesses casos o AUDITOR também descarta capa/gênero herdados do match errado.
 */
export function juizCreditoConflita(
  ev: Evidencia,
  atualArtist: string | null | undefined,
): boolean {
  const atual = atualArtist?.trim();
  if (!atual || atual === 'Desconhecido') return false;
  const parsed = ev.rawTitle ? cleanQuery(ev.rawTitle) : { title: '' };
  const temEvidencia = Boolean(ev.sourceArtist || parsed.artist || ev.uploader);
  if (!temEvidencia) return false;
  const alvo = norm(atual);
  if (!alvo) return false;
  const corpus = [ev.sourceArtist, ev.sourceAlbum, ev.uploader, ev.rawTitle, ev.sourceTrack]
    .filter((v): v is string => Boolean(v))
    .map(norm)
    .join(' | ');
  return !corpus.includes(alvo);
}

// ── AGENTE 3 · VERIFICADOR ──────────────────────────────────────────────────

/**
 * VERIFICADOR: confirma um crédito no catálogo (iTunes) — título E artista
 * precisam bater estritamente. Sem um palpite sustentado por evidência
 * (regra do JUIZ), ele se recusa a procurar: buscar só por título é
 * exatamente o que fabricava artistas errados.
 */
export async function verificadorConfirma(
  title: string,
  artistHint: string | null | undefined,
): Promise<EnrichedMeta | null> {
  const hint = artistHint?.trim();
  if (!hint || hint === 'Desconhecido') return null;
  return verifyIdentity(title, hint);
}

/**
 * VERIFICADOR — lente de TÍTULO. Só para a faixa que não tem crédito NENHUM a
 * proteger (arquivo solto sem tag embutida e com nome que não diz o artista).
 * Sem isso ela ficava "Desconhecido" para sempre: o caminho normal se recusa a
 * procurar sem palpite, então nunca ganhava capa, álbum, gênero nem letra.
 * A prova exigida é alta (ver identifyByTitle) — na dúvida, devolve null.
 */
export async function verificadorPorTitulo(
  title: string,
  artistAtual: string | null | undefined,
): Promise<EnrichedMeta | null> {
  const atual = artistAtual?.trim();
  if (atual && atual !== 'Desconhecido') return null; // há crédito: não mexer
  const t = title.trim();
  if (!t) return null;
  return identifyByTitle(t);
}

/** Título de faixa bate: igualdade normalizada, ou sufixo curto (live/remaster). */
const tituloBate = (a: string, b: string): boolean => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return long.startsWith(`${short} `) && long.length - short.length <= 18;
};

/** Título de álbum bate: igualdade, ou edição estendida ("Midnights (3am Edition)"). */
const albumBate = (a: string, b: string): boolean => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return long.startsWith(short) && long.length - short.length <= 25;
};

/** O que a lente de álbum devolve quando as DUAS provas fecham. */
export interface VeredictoAlbum {
  artist: string;
  album: string;
  coverUrl: string | null;
}

/**
 * VERIFICADOR — a "lente" de álbum. Quando a FONTE cita um álbum (yt-dlp
 * `album`), identifica esse álbum real no catálogo (Deezer, via importer) e
 * adota o artista/capa autoritativos dele — mas SÓ quando duas provas
 * independentes fecham: (1) o título do álbum bate com o citado pela fonte e
 * (2) a faixa está na tracklist oficial. É o que devolve as faixas do
 * "Nadando Cem Os Tubarões" ao Charlie Brown Jr. mesmo que um match antigo
 * as tenha creditado a outra pessoa. Sem álbum na fonte, não faz nada.
 */
export async function verificadorAlbum(ev: Evidencia): Promise<VeredictoAlbum | null> {
  if (!ev.sourceAlbum) return null;
  const hint = ev.sourceArtist ?? ev.uploader ?? undefined;
  const info = await fetchAlbumInfo(ev.sourceAlbum, hint);
  if (!info || info.tracks.length === 0) return null;
  if (!albumBate(info.title, ev.sourceAlbum)) return null; // não é o álbum citado
  const wantedTitle = ev.sourceTrack || (ev.rawTitle ? cleanQuery(ev.rawTitle).title : '');
  if (!wantedTitle) return null;
  const pertence = info.tracks.some((t) => tituloBate(t, wantedTitle));
  if (!pertence) return null; // a faixa não está nesse álbum — não adota nada
  return { artist: info.artist, album: info.title, coverUrl: info.coverUrl };
}
