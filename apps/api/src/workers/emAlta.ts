/**
 * "EM ALTA" POR GÊNERO — a parte PURA: ler cada parada, fundir, dar gênero.
 *
 * O worker (`emAlta.worker.ts`) faz a rede e grava; aqui não há rede nem
 * banco, só funções testáveis. O contrato de saída está em
 * `@radinho/shared` (`FaixaEmAlta`, `EmAltaDto`).
 *
 * ── AS FONTES, E O QUE CADA UMA SABE ──
 *
 *  • DEEZER (`/chart/{gênero}/tracks`): paradas por gênero editorial, com o
 *    selo `explicit_lyrics` da gravadora, capa e duração. É a fonte mais rica.
 *  • APPLE (RSS `topsongs/genre={id}` + `lookup`): paradas por gênero da loja
 *    brasileira, com `trackExplicitness`. O RSS dá a ordem; o `lookup` dá o
 *    selo e a duração.
 *  • YOUTUBE ("Top 100 Songs Brazil/Global", pelo importador): o que mais toca
 *    de fato, mas sem gênero nem selo — o nome do vídeo vira título e artista
 *    por `lerTituloDeVideo`, e o gênero vem das outras fontes ou do acervo.
 *
 * ── A FUSÃO ──
 *
 * A identidade de uma música é "artista|título" normalizado (`chaveDaMusica`,
 * a mesma do agente pesquisador): "(Ao Vivo)", acento e caixa não separam o
 * que é a mesma gravação. A NOTA soma a posição em cada parada (topo vale
 * mais) com um bônus por aparecer em várias — estar no topo do Deezer E do
 * YouTube diz mais que estar no topo de um só.
 *
 * ── O GÊNERO ──
 *
 * Cada parada de gênero vota no gênero da taxonomia que ela representa. A
 * parada "Rap/Funk Brasileiro" do Deezer mistura dois gêneros nossos; o nome
 * do artista desempata (MC/DJ → Funk). Sem voto de parada, vale o gênero do
 * acervo (a própria faixa, ou o que o ARTISTA costuma ser por lá — a melhor
 * prova de gênero que temos de graça, ver `generoCoerencia`). Sem nada, a
 * faixa só entra na parada geral.
 *
 * ── O CONTEÚDO ──
 *
 * Do mais forte para o mais fraco: o veredito do acervo (letra julgada no
 * servidor) > o TÍTULO com palavrão (condena) > o selo das fontes (qualquer
 * fonte dizendo explícito condena; todas as que sabem dizendo limpo absolve) >
 * `desconhecido`. Quem aplica a idade é o aparelho, pela regra única.
 */
import {
  classificarTexto,
  GENERO_TODOS,
  GENRE_TAXONOMY,
  lerTituloDeVideo,
  type FaixaEmAlta,
  type FonteDeParada,
  type Genre,
  type GeneroEmAlta,
  type VeredictoDeConteudo,
} from '@radinho/shared';

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function chaveDaMusica(artista: string, titulo: string): string {
  return `${norm(artista)}|${norm(titulo)}`;
}

/** Uma linha de uma parada, já no nosso vocabulário. */
export interface EntradaDeParada {
  fonte: FonteDeParada;
  /** Gênero da taxonomia que a parada representa; `null` = parada geral. */
  genero: Genre | null;
  /** 1 = topo da parada. */
  posicao: number;
  titulo: string;
  artista: string;
  capa: string | null;
  duracaoMs: number | null;
  /** O que a fonte afirma: `true` explícito, `false` limpo, `null` não sabe. */
  explicito: boolean | null;
  /** Link que a fila de import entende (YouTube, Deezer, Apple). */
  origem: string | null;
}

/** O que precisamos saber de cada faixa do acervo (sem o `dna`). */
export interface FaixaDoAcervo {
  id: string;
  titulo: string;
  artista: string;
  genero: string | null;
  veredicto: VeredictoDeConteudo | null;
  tocavel: boolean;
}

// ── Deezer ──────────────────────────────────────────────────────────────────

/** Paradas por gênero do Deezer (ids conferidos em `GET /genre`, 27/10/2026). */
export const PARADAS_DEEZER: ReadonlyArray<{ id: number; genero: Genre | null }> = [
  { id: 0, genero: null },
  { id: 132, genero: 'Pop' },
  { id: 80, genero: 'Sertanejo' },
  { id: 78, genero: 'MPB' },
  { id: 472, genero: 'Hip-Hop/Rap' }, // "Rap/Funk Brasileiro": MC/DJ vira Funk (ver abaixo)
  { id: 116, genero: 'Hip-Hop/Rap' },
  { id: 122, genero: 'Reggaeton' },
  { id: 152, genero: 'Rock' },
  { id: 113, genero: 'Dance' },
  { id: 165, genero: 'R&B/Soul' },
  { id: 85, genero: 'Indie' }, // "Alternativo"
  { id: 79, genero: 'Pagode' }, // "Samba/Pagode"
  { id: 106, genero: 'Eletrônica' }, // "Electro"
  { id: 186, genero: 'Gospel' }, // "Música Religiosa"
  { id: 76, genero: 'Forró' }, // "Axé/Forró"
  { id: 144, genero: 'Reggae' },
  { id: 129, genero: 'Jazz' },
  { id: 98, genero: 'Clássica' },
  { id: 464, genero: 'Metal' },
  { id: 169, genero: 'R&B/Soul' }, // "Soul & Funk" (o funk americano, não o do Rio)
  { id: 153, genero: 'Blues' },
];

/** A parada "Rap/Funk Brasileiro" é duas: o crédito do artista decide. */
const PARADA_RAP_FUNK = 472;
const CREDITO_DE_FUNK = /(?:^|\s)(?:mc|dj|mcs)\s/i;

export function generoDoRapFunk(artista: string, titulo: string): Genre {
  return CREDITO_DE_FUNK.test(`${artista} ${titulo}`) ? 'Funk' : 'Hip-Hop/Rap';
}

interface DeezerFaixa {
  title?: string;
  title_short?: string;
  duration?: number;
  explicit_lyrics?: boolean;
  /** 0 não, 1 sim, 2 desconhecido, 3 editada, 6 sem aviso, 7 parcialmente. */
  explicit_content_lyrics?: number;
  link?: string;
  position?: number;
  artist?: { name?: string };
  album?: { cover_medium?: string; cover_big?: string };
}

export function entradasDoDeezer(
  paradaId: number,
  generoDaParada: Genre | null,
  resposta: { data?: unknown },
): EntradaDeParada[] {
  const linhas = Array.isArray(resposta.data) ? (resposta.data as DeezerFaixa[]) : [];
  const saida: EntradaDeParada[] = [];
  for (const [i, r] of linhas.entries()) {
    const titulo = (r?.title ?? r?.title_short ?? '').trim();
    const artista = (r?.artist?.name ?? '').trim();
    if (!titulo || !artista) continue;
    const codigo = r.explicit_content_lyrics;
    const explicito =
      codigo === 1 || codigo === 7
        ? true
        : codigo === 0 || codigo === 3
          ? false
          : r.explicit_lyrics === true
            ? true
            : null;
    const genero =
      paradaId === PARADA_RAP_FUNK ? generoDoRapFunk(artista, titulo) : generoDaParada;
    saida.push({
      fonte: 'deezer',
      genero,
      posicao: typeof r.position === 'number' && r.position > 0 ? r.position : i + 1,
      titulo,
      artista,
      capa: r.album?.cover_big ?? r.album?.cover_medium ?? null,
      duracaoMs: typeof r.duration === 'number' && r.duration > 0 ? r.duration * 1000 : null,
      explicito,
      origem: typeof r.link === 'string' && /^https:\/\/www\.deezer\.com\//.test(r.link) ? r.link : null,
    });
  }
  return saida;
}

// ── Apple ───────────────────────────────────────────────────────────────────

/** Paradas por gênero da loja brasileira (ids da Apple; conferidos 27/10/2026). */
export const PARADAS_APPLE: ReadonlyArray<{ id: number; genero: Genre }> = [
  { id: 14, genero: 'Pop' },
  { id: 18, genero: 'Hip-Hop/Rap' },
  { id: 15, genero: 'R&B/Soul' },
  { id: 17, genero: 'Dance' },
  { id: 7, genero: 'Eletrônica' },
  { id: 21, genero: 'Rock' },
  { id: 20, genero: 'Indie' }, // "Alternativo"
  { id: 12, genero: 'Latina' },
  { id: 6, genero: 'Country' },
  { id: 1332, genero: 'Sertanejo' },
  { id: 1122, genero: 'MPB' },
  { id: 1123, genero: 'Funk' },
  { id: 22, genero: 'Gospel' }, // "Música religiosa"
  { id: 24, genero: 'Reggae' },
  { id: 11, genero: 'Jazz' },
  { id: 5, genero: 'Clássica' },
  { id: 1153, genero: 'Metal' },
  { id: 2, genero: 'Blues' },
  { id: 51, genero: 'K-Pop' },
];

interface AppleRssEntrada {
  'im:name'?: { label?: string };
  'im:artist'?: { label?: string };
  'im:image'?: Array<{ label?: string }>;
  id?: { label?: string; attributes?: { 'im:id'?: string } };
}

export interface AppleLookup {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  trackExplicitness?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

/** Só os ids do RSS, na ordem da parada: é o que o `lookup` recebe. */
export function idsDoRssDaApple(rss: unknown): string[] {
  const feed = (rss as { feed?: { entry?: unknown } } | null)?.feed;
  const bruto = feed?.entry;
  const entradas = (Array.isArray(bruto) ? bruto : bruto ? [bruto] : []) as AppleRssEntrada[];
  return entradas
    .map((e) => e?.id?.attributes?.['im:id'] ?? '')
    .filter((id) => /^\d+$/.test(id));
}

export function entradasDaApple(
  genero: Genre,
  rss: unknown,
  lookup: ReadonlyMap<string, AppleLookup>,
): EntradaDeParada[] {
  const feed = (rss as { feed?: { entry?: unknown } } | null)?.feed;
  const bruto = feed?.entry;
  const entradas = (Array.isArray(bruto) ? bruto : bruto ? [bruto] : []) as AppleRssEntrada[];
  const saida: EntradaDeParada[] = [];
  for (const [i, e] of entradas.entries()) {
    const id = e?.id?.attributes?.['im:id'] ?? '';
    const detalhe = lookup.get(id);
    const titulo = (detalhe?.trackName ?? e?.['im:name']?.label ?? '').trim();
    const artista = (detalhe?.artistName ?? e?.['im:artist']?.label ?? '').trim();
    if (!titulo || !artista) continue;
    const imagens = e?.['im:image'] ?? [];
    const capaRss = imagens[imagens.length - 1]?.label ?? null;
    const capa = detalhe?.artworkUrl100
      ? detalhe.artworkUrl100.replace('100x100bb', '600x600bb')
      : capaRss
        ? capaRss.replace(/\/\d+x\d+bb\./, '/600x600bb.')
        : null;
    const selo = detalhe?.trackExplicitness;
    const explicito = selo === 'explicit' ? true : selo === 'notExplicit' || selo === 'cleaned' ? false : null;
    const origem = detalhe?.trackViewUrl ?? e?.id?.label ?? null;
    saida.push({
      fonte: 'apple',
      genero,
      posicao: i + 1,
      titulo,
      artista,
      capa,
      duracaoMs:
        typeof detalhe?.trackTimeMillis === 'number' && detalhe.trackTimeMillis > 0
          ? Math.round(detalhe.trackTimeMillis)
          : null,
      explicito,
      origem: origem && /^https:\/\/music\.apple\.com\//.test(origem) ? origem : null,
    });
  }
  return saida;
}

// ── YouTube ─────────────────────────────────────────────────────────────────

/** Listas do canal "YouTube Music Global Charts" (conferidas 27/10/2026). */
export const PLAYLISTS_YOUTUBE: ReadonlyArray<{ id: string; rotulo: string }> = [
  { id: 'PL4fGSI1pDJn7rGBE8kEC0CqTa1nMh9AKB', rotulo: 'Top 100 Songs Brazil' },
  { id: 'PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i', rotulo: 'Top 100 Songs Global' },
];

/** Vídeo que não é a música em si (não vale para a parada). */
const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|remix|reac(?:t|tion|ting)|tutorial)\b/i;

export function entradasDoYoutube(
  entradas: ReadonlyArray<{ url: string; title: string; duracaoSeg?: number }>,
): EntradaDeParada[] {
  const saida: EntradaDeParada[] = [];
  for (const [i, e] of entradas.entries()) {
    if (!e?.url || !e.title || VERSAO_ALTERADA.test(e.title)) continue;
    const lido = lerTituloDeVideo(e.title);
    const artista = lido.artists[0]?.trim() ?? '';
    const titulo = lido.title.trim();
    if (!artista || !titulo) continue;
    const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(e.url);
    saida.push({
      fonte: 'youtube',
      genero: null,
      posicao: i + 1,
      titulo,
      artista,
      capa: m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null,
      duracaoMs: typeof e.duracaoSeg === 'number' && e.duracaoSeg > 0 ? e.duracaoSeg * 1000 : null,
      explicito: null,
      origem: e.url,
    });
  }
  return saida;
}

// ── Fusão ───────────────────────────────────────────────────────────────────

/** Quanto cada fonte pesa: o YouTube mede o que toca; a Apple é a loja menor. */
const PESO_DA_FONTE: Readonly<Record<FonteDeParada, number>> = {
  youtube: 1,
  deezer: 1,
  apple: 0.8,
};
/** Bônus por fonte a mais em que a música aparece. */
const BONUS_POR_FONTE_EXTRA = 0.25;
/** Posição além desta já não conta nada. */
const PROFUNDIDADE = 100;

function notaDaPosicao(posicao: number): number {
  return Math.max(0, 1 - (posicao - 1) / PROFUNDIDADE);
}

/** O veredito que resulta dos selos das fontes (ver cabeçalho). */
export function conteudoDasFontes(selos: ReadonlyArray<boolean | null>): VeredictoDeConteudo {
  if (selos.some((s) => s === true)) return 'explicito';
  if (selos.some((s) => s === false)) return 'limpo';
  return 'desconhecido';
}

interface Acumulado {
  chave: string;
  titulo: string;
  artista: string;
  capa: string | null;
  duracaoMs: number | null;
  nota: number;
  fontes: Set<FonteDeParada>;
  votos: Map<Genre, number>;
  selos: Array<boolean | null>;
  origens: Partial<Record<FonteDeParada, string>>;
  /** De onde vieram título e artista: o nome de vídeo cede ao catálogo. */
  nomeDe: FonteDeParada;
}

export function fundirParadas(
  entradas: readonly EntradaDeParada[],
  acervo: readonly FaixaDoAcervo[],
  opcoes: { porGenero?: number } = {},
): GeneroEmAlta[] {
  const porGenero = opcoes.porGenero ?? 30;

  // O acervo, por chave de música e por artista (o gênero que ele costuma ter).
  const noAcervo = new Map<string, FaixaDoAcervo>();
  const votosDoArtista = new Map<string, Map<string, number>>();
  for (const f of acervo) {
    const chave = chaveDaMusica(f.artista, f.titulo);
    const atual = noAcervo.get(chave);
    // Entre duplicatas, a que toca e tem veredito vale mais.
    if (!atual || (!atual.tocavel && f.tocavel) || (!atual.veredicto && f.veredicto)) {
      noAcervo.set(chave, f);
    }
    if (f.genero) {
      const a = norm(f.artista);
      const v = votosDoArtista.get(a) ?? new Map<string, number>();
      v.set(f.genero, (v.get(f.genero) ?? 0) + 1);
      votosDoArtista.set(a, v);
    }
  }
  const generoDoArtista = (artista: string): string | null => {
    const v = votosDoArtista.get(norm(artista));
    if (!v) return null;
    let melhor: string | null = null;
    let max = 0;
    for (const [g, n] of v) if (n > max) [melhor, max] = [g, n];
    return melhor;
  };
  const taxonomia = new Set<string>(GENRE_TAXONOMY);

  const musicas = new Map<string, Acumulado>();
  for (const e of entradas) {
    const chave = chaveDaMusica(e.artista, e.titulo);
    if (chave.length < 3 || chave.startsWith('|') || chave.endsWith('|')) continue;
    let m = musicas.get(chave);
    if (!m) {
      m = {
        chave,
        titulo: e.titulo,
        artista: e.artista,
        capa: null,
        duracaoMs: null,
        nota: 0,
        fontes: new Set(),
        votos: new Map(),
        selos: [],
        origens: {},
        nomeDe: e.fonte,
      };
      musicas.set(chave, m);
    } else if (m.nomeDe === 'youtube' && e.fonte !== 'youtube') {
      // "Matuê - Mantém (Clipe Oficial)" lido do vídeo vs. o título do
      // catálogo: o catálogo escreve certo.
      m.titulo = e.titulo;
      m.artista = e.artista;
      m.nomeDe = e.fonte;
    }
    m.nota += PESO_DA_FONTE[e.fonte] * notaDaPosicao(e.posicao);
    m.fontes.add(e.fonte);
    if (e.genero) m.votos.set(e.genero, (m.votos.get(e.genero) ?? 0) + 1);
    m.selos.push(e.explicito);
    // A capa do Deezer/Apple é a do disco; a do YouTube é o quadro do vídeo.
    if (!m.capa || (e.fonte !== 'youtube' && m.capa.includes('ytimg.com'))) m.capa = e.capa ?? m.capa;
    if (!m.duracaoMs && e.duracaoMs) m.duracaoMs = e.duracaoMs;
    if (e.origem && !m.origens[e.fonte]) m.origens[e.fonte] = e.origem;
  }

  const faixas: FaixaEmAlta[] = [];
  for (const m of musicas.values()) {
    const noAcervoDesta = noAcervo.get(m.chave);
    let genero: string | null = null;
    let maisVotos = 0;
    for (const [g, n] of m.votos) if (n > maisVotos) [genero, maisVotos] = [g, n];
    if (!genero) {
      const doAcervo = noAcervoDesta?.genero ?? generoDoArtista(m.artista);
      genero = doAcervo && taxonomia.has(doAcervo) ? doAcervo : null;
    }
    const conteudo: VeredictoDeConteudo =
      noAcervoDesta?.veredicto ??
      (classificarTexto(m.titulo).veredicto === 'explicito' ? 'explicito' : conteudoDasFontes(m.selos));
    faixas.push({
      chave: m.chave,
      titulo: m.titulo,
      artista: m.artista,
      genero,
      capa: m.capa,
      duracaoMs: m.duracaoMs,
      posicao: 0,
      nota: Math.round((m.nota + BONUS_POR_FONTE_EXTRA * (m.fontes.size - 1)) * 1000) / 1000,
      fontes: [...m.fontes],
      conteudo,
      acervoId: noAcervoDesta?.tocavel ? noAcervoDesta.id : null,
      // O YouTube é o caminho que o importador já percorre sem resolver nada.
      origem: m.origens.youtube ?? m.origens.deezer ?? m.origens.apple ?? null,
    });
  }
  faixas.sort((a, b) => b.nota - a.nota || a.chave.localeCompare(b.chave));

  const saida: GeneroEmAlta[] = [];
  const numerar = (lista: FaixaEmAlta[]): FaixaEmAlta[] =>
    lista.slice(0, porGenero).map((f, i) => ({ ...f, posicao: i + 1 }));
  saida.push({ genero: GENERO_TODOS, faixas: numerar(faixas) });
  for (const genero of GENRE_TAXONOMY) {
    const doGenero = faixas.filter((f) => f.genero === genero);
    if (doGenero.length > 0) saida.push({ genero, faixas: numerar(doGenero) });
  }
  return saida;
}
