/**
 * Biografia real do artista, em cache.
 *
 * A fonte é a Wikipédia (texto) conferida pelo Wikidata (identidade). As duas
 * mandam CORS aberto e não pedem chave, então dá para chamar direto do
 * navegador — nenhum token nosso viaja para lá, é requisição anônima a host de
 * terceiro. Prefere o verbete em pt; cai para en quando não existe.
 *
 * POR QUE O WIKIDATA ENTROU. A versão anterior buscava "<nome> música" na
 * Wikipédia e aceitava o PRIMEIRO resultado cujo texto tivesse uma palavra de
 * música ("banda", "pop", "álbum"…). Isso prova que o verbete fala de música,
 * não que fala DESTE artista: a busca por "Ludmilla música" devolve o verbete
 * de outra cantora que gravou com ela, o de um álbum, o de um festival — e
 * todos passam no teste. Era daí a bio "nada a ver" (pessoa errada, homônimo).
 *
 * Agora a bio só é aceita quando há evidência de identidade:
 *   1. o NOME do item no Wikidata (rótulo ou apelido) é igual ao do artista —
 *      verbete de parceiro, de álbum ou de festival cai aqui;
 *   2. o item É um artista musical — ocupação cantor/músico/rapper/DJ…, tipo
 *      banda/grupo/dupla, ou IDs de artista no MusicBrainz E num streaming —
 *      a cidade de Fresno e o gênero Skank caem aqui;
 *   3. se sobrar mais de um homônimo musical, desempata pelas faixas/álbuns do
 *      acervo citados no verbete, ou por notoriedade esmagadora. Sem desempate
 *      claro, NÃO mostra nada: bio da pessoa errada é pior que nenhuma.
 */
import { useSyncExternalStore } from 'react';
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';

/**
 * A chave carrega versão: o cache antigo guardou bios de gente errada por 30
 * dias, e consertar a busca não apagaria o que já está no aparelho. Subir o
 * número aposenta tudo de uma vez (mesmo padrão de lib/artistImage.ts).
 */
const CACHE_KEY = 'aurial:artist-bios:v2';
const CHAVE_ANTIGA = 'aurial:artist-bios';
// Verbete de artista muda pouco; 30 dias evita refetch sem congelar para sempre.
const TTL_MS = 30 * 24 * 60 * 60_000;
// Falha de REDE não é "não existe bio": guardar isso por 30 dias deixaria a
// seção vazia por um mês depois de uma visita offline. Tenta de novo logo.
const TTL_FALHA_MS = 10 * 60_000;
const TIMEOUT_MS = 6_000;
/** Homônimos musicais cujo verbete lemos para desempatar — teto de requisições. */
const MAX_DESEMPATE = 3;

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/**
 * Radicais longos o bastante para valerem como prefixo — "music…" só aparece em
 * palavra de música, "cantor…" idem.
 */
const MUSIC_STEM =
  /\b(music|cantor|cantautor|composit|instrumentist|guitarrist|baterist|baixist|rapper|songwriter|sertanej|discograf|banda|bandas)/;

/**
 * Palavras curtas e ambíguas: só valem INTEIRAS. Sem o `\b` final, "pop" casava
 * com "populosa" e a cidade de Fresno passava por banda — exatamente o
 * homônimo que esta checagem existe para barrar.
 */
const MUSIC_WORD =
  /\b(pop|rock|rap|jazz|dj|samba|pagode|funk|blues|reggae|duo|band|bands|singer|musician|album|albuns|albums|hip hop|grupo musical|produtor musical|record producer)\b/;

/**
 * Ocupações (P106) que fazem de uma pessoa um artista musical. Lista curta de
 * propósito: as ocupações mais específicas ("cantor de pagode") quase sempre
 * vêm junto com uma destas, e quem escapar é pego pelos IDs de artista.
 */
const OCUPACOES_MUSICAIS = new Set([
  'Q177220', // cantor
  'Q639669', // músico
  'Q2252262', // rapper
  'Q488205', // cantor-compositor
  'Q753110', // compositor de canções
  'Q36834', // compositor
  'Q855091', // guitarrista
  'Q386854', // baterista
  'Q584301', // baixista
  'Q486748', // pianista
  'Q183945', // produtor musical
  'Q130857', // DJ
  'Q1278335', // instrumentista
  'Q822146', // letrista
  'Q2865819', // cantor de ópera
]);

/** Tipos (P31) de grupo musical: banda, dupla, boy band… */
const TIPOS_DE_GRUPO = new Set([
  'Q215380', // grupo musical
  'Q2088357', // conjunto musical
  'Q5741069', // banda de rock
  'Q9212979', // dupla musical
  'Q216337', // boy band
  'Q641066', // girl group
]);

/** ID de artista no MusicBrainz — existe para quem grava, não para cidade. */
const P_MUSICBRAINZ = 'P434';
/** IDs de artista em streaming (Spotify, Deezer, Apple Music). */
const P_STREAMING = ['P1902', 'P2722', 'P2850'];

/** Texto sem acento e em minúsculas — `\b` do JS só entende ASCII. */
const flatten = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Forma canônica de um NOME para comparar catálogo × Wikidata: sem acento,
 * pontuação vira espaço ("MC’s" = "MC's"), "&" = "e"/"and" e o artigo "the"
 * inicial é opcional ("Beatles" = "The Beatles").
 */
export function normalizarNome(value: string): string {
  return flatten(value)
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\band\b/g, 'e')
    .trim()
    .replace(/^the /, '')
    .replace(/\s+/g, ' ');
}

export interface ArtistBio {
  text: string;
  /** Título do verbete — o crédito visível ("Wikipédia (pt)"). */
  title: string;
  lang: string;
  url: string | null;
  /** Item do Wikidata que provou a identidade (Q…). */
  qid?: string;
  /** Foto do verbete — reserva quando o catálogo não tem foto do artista. */
  imageUrl?: string | null;
}

/** Pistas do catálogo para desempatar homônimos: títulos de faixas e álbuns. */
export interface BioHints {
  titles?: readonly string[];
}

interface CachedBio {
  bio: ArtistBio | null;
  at: number;
  /** A busca falhou por rede — vale só por TTL_FALHA_MS. */
  falha?: boolean;
}

type Cache = Record<string, CachedBio>;

let cache: Cache | null = null;
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function read(): Cache {
  if (cache) return cache;
  try {
    window.localStorage.removeItem(CHAVE_ANTIGA);
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Cache): void {
  cache = next;
  // Enfeite com teto e sacrificável: uma biografia volta numa chamada, a
  // biblioteca do usuário não volta de lugar nenhum. Ver lib/local/cofreLocal.ts.
  gravarCache(CACHE_KEY, JSON.stringify(next), 300_000);
  emit();
}

registrarDescartavel(CACHE_KEY, 20, () => {
  cache = null;
});

const normKey = (name: string): string => name.trim().toLowerCase();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True quando o texto prova que o verbete fala de música (anti-homônimo). */
export function looksMusical(...parts: Array<string | null | undefined>): boolean {
  const text = flatten(parts.filter(Boolean).join(' '));
  return MUSIC_STEM.test(text) || MUSIC_WORD.test(text);
}

/** A fonte não respondeu (rede/timeout/5xx) — diferente de "não achei". */
export class BioIndisponivel extends Error {
  constructor() {
    super('fonte da biografia indisponível');
  }
}

/**
 * GET com teto de tempo — busca de bio nunca pode pendurar a página. 404 é
 * resposta ("não existe"); rede caída ou 5xx vira BioIndisponivel.
 */
async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch {
    throw new BioIndisponivel();
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500 || res.status === 429) throw new BioIndisponivel();
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Wikidata

interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } };
}

export interface WdEntity {
  id?: string;
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
  claims?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title?: string }>;
}

/** Os Q-ids de uma propriedade de item (P31, P106…). */
function qidsDe(entity: WdEntity, prop: string): string[] {
  return (entity.claims?.[prop] ?? [])
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: unknown } | undefined)?.id)
    .filter((id): id is string => typeof id === 'string');
}

const temClaim = (entity: WdEntity, prop: string): boolean =>
  (entity.claims?.[prop]?.length ?? 0) > 0;

/**
 * O item é um artista musical? Ocupação ou tipo de grupo resolvem direto. Os
 * IDs de artista só valem EM DUPLA (MusicBrainz + um streaming): um só pode
 * aparecer em ator que narrou um audiolivro; os dois juntos, não.
 */
export function ehArtistaMusical(entity: WdEntity): boolean {
  if (qidsDe(entity, 'P106').some((q) => OCUPACOES_MUSICAIS.has(q))) return true;
  if (qidsDe(entity, 'P31').some((q) => TIPOS_DE_GRUPO.has(q))) return true;
  return temClaim(entity, P_MUSICBRAINZ) && P_STREAMING.some((p) => temClaim(entity, p));
}

/** Algum rótulo ou apelido do item é exatamente o nome do artista? */
export function mesmoNome(entity: WdEntity, name: string): boolean {
  const alvo = normalizarNome(name);
  if (!alvo) return false;
  const nomes = [
    ...Object.values(entity.labels ?? {}).map((l) => l.value),
    ...Object.values(entity.aliases ?? {}).flatMap((list) => list.map((a) => a.value)),
  ];
  return nomes.some((n) => typeof n === 'string' && normalizarNome(n) === alvo);
}

const qtdSitelinks = (entity: WdEntity): number => Object.keys(entity.sitelinks ?? {}).length;

interface SearchEntitiesResponse {
  search?: Array<{ id?: string }>;
}

/** Candidatos do Wikidata pelo nome (rótulo/apelido), num idioma. */
async function buscarCandidatos(name: string, lang: string): Promise<string[]> {
  const data = await getJson<SearchEntitiesResponse>(
    `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(
      name,
    )}&language=${lang}&uselang=${lang}&type=item&limit=10&format=json&origin=*`,
  );
  return (data?.search ?? [])
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id));
}

interface GetEntitiesResponse {
  entities?: Record<string, WdEntity>;
}

/** Os itens completos numa ÚNICA chamada — nunca uma requisição por candidato. */
async function carregarEntidades(ids: string[]): Promise<WdEntity[]> {
  if (ids.length === 0) return [];
  const data = await getJson<GetEntitiesResponse>(
    `${WIKIDATA_API}?action=wbgetentities&ids=${ids.join(
      '|',
    )}&props=labels|aliases|claims|sitelinks&languages=pt|pt-br|en&format=json&origin=*`,
  );
  return Object.values(data?.entities ?? {});
}

// --------------------------------------------------------------- Wikipédia

interface Summary {
  type?: string;
  title?: string;
  extract?: string;
  wikibase_item?: string;
  content_urls?: { desktop?: { page?: string } };
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
}

/**
 * O resumo do verbete que o PRÓPRIO item do Wikidata aponta (sitelink), num
 * idioma. Confere que o verbete volta ligado ao mesmo item — um redirect na
 * Wikipédia não pode trocar a pessoa no meio do caminho.
 */
async function resumoDoItem(entity: WdEntity, lang: string): Promise<ArtistBio | null> {
  const title = entity.sitelinks?.[`${lang}wiki`]?.title;
  if (!title) return null;
  const data = await getJson<Summary>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  );
  const text = typeof data?.extract === 'string' ? data.extract.trim() : '';
  if (!text || data?.type === 'disambiguation') return null;
  if (data?.wikibase_item && entity.id && data.wikibase_item !== entity.id) return null;
  const imagem = data?.originalimage?.source ?? data?.thumbnail?.source ?? null;
  return {
    text,
    title: typeof data?.title === 'string' ? data.title : title,
    lang,
    url: data?.content_urls?.desktop?.page ?? null,
    qid: entity.id,
    imageUrl: typeof imagem === 'string' && imagem.startsWith('https://') ? imagem : null,
  };
}

/** pt primeiro; en quando não há verbete em português. */
async function resumo(entity: WdEntity): Promise<ArtistBio | null> {
  return (await resumoDoItem(entity, 'pt')) ?? (await resumoDoItem(entity, 'en'));
}

/** O texto cita alguma faixa/álbum do acervo? Títulos curtos demais não contam. */
function citaTitulo(text: string, titles: readonly string[]): boolean {
  const corpo = ` ${normalizarNome(text)} `;
  return titles
    .map(normalizarNome)
    .filter((t) => t.length >= 4)
    .some((t) => corpo.includes(` ${t} `));
}

/**
 * A bio do artista, ou null quando não há evidência suficiente de que é ELE.
 * Lança BioIndisponivel quando a fonte não respondeu (para não cachear o
 * "não achei" de uma falha de rede).
 */
export async function fetchArtistBio(
  name: string,
  hints: BioHints = {},
): Promise<ArtistBio | null> {
  const nome = name.trim();
  if (!nome) return null;

  // Busca em pt; en só se pt não trouxe ninguém com o nome (economiza chamada).
  let artistas: WdEntity[] = [];
  for (const lang of ['pt', 'en']) {
    const entidades = await carregarEntidades(await buscarCandidatos(nome, lang));
    artistas = entidades.filter((e) => mesmoNome(e, nome) && ehArtistaMusical(e));
    if (artistas.length > 0) break;
  }
  if (artistas.length === 0) return null;

  // Um único artista musical com esse nome: identidade resolvida.
  if (artistas.length === 1) return resumo(artistas[0]!);

  // Homônimos musicais. Primeiro a prova mais forte: o verbete cita uma
  // faixa/álbum que o usuário tem desse artista.
  const porFama = [...artistas].sort((a, b) => qtdSitelinks(b) - qtdSitelinks(a));
  const titles = hints.titles ?? [];
  if (titles.length > 0) {
    const resumos = await Promise.all(porFama.slice(0, MAX_DESEMPATE).map(resumo));
    const citam = resumos.filter((r): r is ArtistBio => !!r && citaTitulo(r.text, titles));
    if (citam.length === 1) return citam[0]!;
    if (citam.length > 1) return null;
  }

  // Sem pista do acervo: só aceita quando um é MUITO mais notório (verbete em
  // muitas Wikipédias contra poucas) — "Nirvana" a banda de Seattle, não a
  // britânica dos anos 60. Empate apertado = não mostrar.
  const [primeiro, segundo] = porFama;
  const a = qtdSitelinks(primeiro!);
  const b = qtdSitelinks(segundo!);
  if (a >= 5 && a >= b * 3) return resumo(primeiro!);
  return null;
}

/**
 * Hook: a bio do artista (null enquanto carrega ou quando não existe). Um
 * "não achou" também é cacheado — repetir a busca a cada render seria custo
 * garantido para o mesmo nada. As pistas só servem ao desempate e não entram
 * na chave: o artista é o mesmo com ou sem elas.
 */
export function useArtistBio(name: string, hints?: BioHints): ArtistBio | null {
  useSyncExternalStore(subscribe, () => read()[normKey(name)]?.at ?? 0);
  const key = normKey(name);
  if (!key) return null;
  const hit = read()[key];
  const ttl = hit?.falha ? TTL_FALHA_MS : TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.bio;
  if (!inflight.has(key)) {
    inflight.add(key);
    void fetchArtistBio(name, hints)
      .then((bio) => write({ ...read(), [key]: { bio, at: Date.now() } }))
      .catch(() => write({ ...read(), [key]: { bio: null, at: Date.now(), falha: true } }))
      .finally(() => inflight.delete(key));
  }
  return hit?.bio ?? null;
}
