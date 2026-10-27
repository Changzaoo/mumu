/**
 * AS FONTES DO MUNDO DA MÚSICA — leitura de APIs públicas, com freio.
 *
 * Tudo aqui é chamado pelo worker (`mundo.worker.ts`), nunca por uma página:
 * o app lê do Postgres o que este módulo já trouxe. Cada fonte tem a sua
 * regra de uso e ela é respeitada no único lugar que a chama:
 *
 *   • MusicBrainz — 1 req/s, User-Agent identificado (fila serial, como no
 *     importador). É a ÂNCORA: dá o id do artista, as relações com Wikidata,
 *     YouTube, Bandsintown, Songkick e Discogs, os lançamentos e os eventos
 *     catalogados (festivais, turnês).
 *   • Wikidata — prêmios recebidos (P166) e indicações (P1411), com data e
 *     obra premiada. Só pelo id que o MusicBrainz apontou: buscar por nome
 *     traz homônimo, e prêmio de outra pessoa é pior que nenhum.
 *   • Bandsintown / Ticketmaster — shows com local, data, link de venda e
 *     (Ticketmaster) faixa de preço. Exigem chave; sem ela ficam mudas.
 *   • YouTube — o canal oficial vem do MusicBrainz. Sem chave: o feed RSS
 *     público do canal (últimos vídeos) para achar shows gravados/transmitidos;
 *     com chave: a Data API para transmissões AO VIVO e AGENDADAS. O embed só
 *     é anunciado depois de o oEmbed confirmar que o vídeo permite.
 *
 * Nada de scraping de página: só endpoints publicados para isso.
 *
 * As funções puras (escolher o artista, ler um evento, fundir shows) estão
 * separadas das que fazem rede, para serem testadas sem internet.
 */
import type { TipoDeEvento } from '@prisma/client';
import { chaveDeIdentidadeDoArtista } from '@radinho/shared';
import { env } from '../config/index.js';

/** O que uma fonte devolve, já no formato da tabela `EventoDoArtista`. */
export interface EventoLido {
  id: string;
  tipo: TipoDeEvento;
  titulo: string;
  descricao?: string | null;
  quando?: Date | null;
  local?: string | null;
  cidade?: string | null;
  pais?: string | null;
  preco?: string | null;
  linkIngresso?: string | null;
  link?: string | null;
  youtubeId?: string | null;
  embed?: boolean;
  fonte: string;
  dados?: unknown;
}

export interface LinksDoArtista {
  wikidata?: string;
  youtube?: string;
  bandsintown?: string;
  songkick?: string;
  discogs?: string;
  site?: string;
  instagram?: string;
  spotify?: string;
  deezer?: string;
  wikipedia?: string;
}

/**
 * O ORÇAMENTO — quantas chamadas externas ainda podem sair hoje.
 *
 * Cada `fetch` deste módulo passa por `gastar()`. Quando acaba, as fontes
 * devolvem `null` em vez de bater na rede, e o worker para a batida dizendo
 * por quê. É o que impede um acervo de duas mil artistas de virar uma rajada.
 */
export class Orcamento {
  gastas = 0;
  constructor(readonly teto: number) {}
  gastar(): boolean {
    if (this.gastas >= this.teto) return false;
    this.gastas += 1;
    return true;
  }
  get esgotado(): boolean {
    return this.gastas >= this.teto;
  }
}

const TIMEOUT_MS = 12_000;

export async function lerJson<T>(
  url: string,
  orc: Orcamento,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T | null } | null> {
  if (!orc.gastar()) return null;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': env.MUNDO_USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

async function lerTexto(url: string, orc: Orcamento): Promise<string | null> {
  if (!orc.gastar()) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': env.MUNDO_USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// ── MusicBrainz ──────────────────────────────────────────────────────────────

const MB = 'https://musicbrainz.org/ws/2';
/**
 * 1 req/s é a regra deles; abusar rende bloqueio de IP para o servidor todo.
 * Dois segundos, e não 1,1: o importador (créditos e capas) pode rodar na
 * MESMA máquina e dividir o mesmo limite — medido em 27/10/2026, 1,1 s aqui
 * já rendeu 503 quando os dois coincidiram.
 */
const MB_INTERVALO_MS = 2000;
let mbFila: Promise<unknown> = Promise.resolve();
let mbUltimaEm = 0;

/** Fonte fora do ar ou no limite — diferente de "não encontrado". */
export class FonteIndisponivel extends Error {
  constructor(fonte: string, status: number) {
    super(`${fonte} indisponível (${status})`);
    this.name = 'FonteIndisponivel';
  }
}

export function mb<T>(caminho: string, orc: Orcamento): Promise<T | null> {
  const rodar = async (): Promise<T | null> => {
    const sep = caminho.includes('?') ? '&' : '?';
    const url = `${MB}/${caminho}${sep}fmt=json`;
    let r: { status: number; body: T | null } | null = null;
    // 503 é "espere" (limite de taxa), não "não existe": uma retentativa, e se
    // persistir a fonte é dada como indisponível — a ficha volta à fila logo.
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const espera = mbUltimaEm + MB_INTERVALO_MS * (tentativa + 1) - Date.now();
      if (espera > 0) await new Promise((res) => setTimeout(res, espera));
      mbUltimaEm = Date.now();
      r = await lerJson<T>(url, orc);
      if (r === null) return null; // sem orçamento
      if (r.status !== 503 && r.status !== 429 && r.status !== 0) break;
    }
    if (r && (r.status === 503 || r.status === 429 || r.status === 0)) {
      throw new FonteIndisponivel('musicbrainz', r.status);
    }
    return r?.body ?? null;
  };
  const resultado = mbFila.then(rodar, rodar);
  mbFila = resultado.then(
    () => undefined,
    () => undefined,
  );
  return resultado;
}

export interface MbArtista {
  id: string;
  name: string;
  type?: string;
  score?: number;
  disambiguation?: string;
  aliases?: Array<{ name?: string }>;
  country?: string;
  area?: { name?: string };
}

/**
 * QUAL DOS CANDIDATOS É O NOSSO ARTISTA. Puro.
 *
 * Só aceita quem tem a MESMA chave de identidade (nome ou apelido). Entre os
 * que passam, o de maior pontuação. Sem casamento exato: `null` — "o mais
 * parecido" é como a bio de outra pessoa foi parar na ficha errada (ver
 * apps/web/src/lib/artistBio.ts).
 */
export function escolherArtistaMB(nome: string, candidatos: MbArtista[]): MbArtista | null {
  const alvo = chaveDeIdentidadeDoArtista(nome);
  if (!alvo) return null;
  let melhor: MbArtista | null = null;
  for (const c of candidatos) {
    const nomes = [c.name, ...(c.aliases ?? []).map((a) => a.name ?? '')];
    if (!nomes.some((n) => n && chaveDeIdentidadeDoArtista(n) === alvo)) continue;
    if (!melhor || (c.score ?? 0) > (melhor.score ?? 0)) melhor = c;
  }
  return melhor;
}

export async function buscarArtistaMB(nome: string, orc: Orcamento): Promise<MbArtista | null> {
  const q = encodeURIComponent(`artist:"${nome.replace(/"/g, '')}"`);
  const r = await mb<{ artists?: MbArtista[] }>(`artist?query=${q}&limit=8`, orc);
  return escolherArtistaMB(nome, r?.artists ?? []);
}

interface MbUrlRel {
  type?: string;
  url?: { resource?: string };
}

/** As relações de URL do MusicBrainz → links que o app e as fontes usam. Puro. */
export function linksDasRelacoes(relations: MbUrlRel[] | undefined): LinksDoArtista {
  const links: LinksDoArtista = {};
  for (const rel of relations ?? []) {
    const url = rel.url?.resource;
    if (!url) continue;
    const tipo = rel.type ?? '';
    if (tipo === 'wikidata') links.wikidata ??= url;
    else if (tipo === 'youtube') links.youtube ??= url;
    else if (tipo === 'bandsintown') links.bandsintown ??= url;
    else if (tipo === 'songkick') links.songkick ??= url;
    else if (tipo === 'discogs') links.discogs ??= url;
    else if (tipo === 'official homepage') links.site ??= url;
    else if (tipo === 'wikipedia') links.wikipedia ??= url;
    else if (tipo === 'streaming' || tipo === 'free streaming') {
      if (/open\.spotify\.com/.test(url)) links.spotify ??= url;
      else if (/deezer\.com/.test(url)) links.deezer ??= url;
    } else if (tipo === 'social network' && /instagram\.com/.test(url)) links.instagram ??= url;
  }
  return links;
}

/** `https://www.wikidata.org/wiki/Q123` → `Q123`. Puro. */
export function idDoWikidata(url: string | undefined): string | null {
  const m = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)/.exec(url ?? '');
  return m?.[1] ?? null;
}

/**
 * `youtube.com/channel/UC…` → `UC…`. `/user/x` e `/@x` precisam da Data API
 * para virar id (ver `canalPorHandle`); sem chave, devolvem `null`. Puro.
 */
export function canalDoYoutube(url: string | undefined): string | null {
  const m = /youtube\.com\/channel\/(UC[\w-]{20,})/.exec(url ?? '');
  return m?.[1] ?? null;
}

export async function lerLinksMB(
  mbid: string,
  orc: Orcamento,
): Promise<{ links: LinksDoArtista } | null> {
  const r = await mb<{ relations?: MbUrlRel[] }>(`artist/${mbid}?inc=url-rels`, orc);
  if (!r) return null;
  return { links: linksDasRelacoes(r.relations) };
}

/**
 * "2026-11-12" → data; "2026-11" → dia 1; "2026" ou vazio → null. Puro.
 *
 * O Wikidata escreve precisão de ano como "+2023-00-00": mês "00" é "não
 * sei o mês" (→ null, não novembro do ano anterior), dia "00" é dia 1.
 */
export function dataParcial(texto: string | undefined | null): Date | null {
  if (!texto) return null;
  const m = /^\+?(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(texto);
  if (!m) return null;
  if (!m[2] || m[2] === '00') return null;
  const dia = !m[3] || m[3] === '00' ? 1 : Number(m[3]);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, dia, 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface MbReleaseGroup {
  id: string;
  title?: string;
  'primary-type'?: string;
  'first-release-date'?: string;
}

/** Lançamento (álbum, EP, single) do MusicBrainz → evento. Puro. */
export function lancamentoDoMB(rg: MbReleaseGroup): EventoLido | null {
  if (!rg.id || !rg.title) return null;
  const quando = dataParcial(rg['first-release-date']);
  const tipo = rg['primary-type'] ?? 'Lançamento';
  return {
    id: `musicbrainz:rg:${rg.id}`,
    tipo: 'LANCAMENTO',
    titulo: rg.title,
    descricao:
      tipo === 'Album' ? 'Álbum' : tipo === 'EP' ? 'EP' : tipo === 'Single' ? 'Single' : tipo,
    quando,
    link: `https://musicbrainz.org/release-group/${rg.id}`,
    fonte: 'musicbrainz',
    dados: { ano: rg['first-release-date']?.slice(0, 4) ?? null },
  };
}

/**
 * Os lançamentos mais recentes. A ordem vem do próprio MusicBrainz (os mais
 * recentes podem estar no fim), então lê a página e ordena aqui.
 */
export async function lancamentosMB(
  mbid: string,
  orc: Orcamento,
  quantos = 4,
): Promise<EventoLido[]> {
  // Só álbum, EP e single (sem coletânea/remix de terceiros), e até três
  // páginas: um artista grande tem centenas de lançamentos e os mais novos
  // podem estar no fim da lista.
  const todos: EventoLido[] = [];
  for (let offset = 0, total = 1; offset < total && offset < 300; offset += 100) {
    const r = await mb<{ 'release-groups'?: MbReleaseGroup[]; 'release-group-count'?: number }>(
      `release-group?artist=${mbid}&type=album|ep|single&limit=100&offset=${offset}`,
      orc,
    );
    if (!r) break;
    total = r['release-group-count'] ?? 0;
    for (const rg of r['release-groups'] ?? []) {
      const e = lancamentoDoMB(rg);
      if (e && e.quando) todos.push(e);
    }
  }
  todos.sort((a, b) => (b.quando?.getTime() ?? 0) - (a.quando?.getTime() ?? 0));
  return todos.slice(0, quantos);
}

interface MbEvento {
  id: string;
  name?: string;
  type?: string;
  time?: string;
  cancelled?: boolean;
  'life-span'?: { begin?: string; end?: string };
  relations?: Array<{
    type?: string;
    'target-type'?: string;
    place?: { name?: string; area?: { name?: string } };
  }>;
}

/** Evento catalogado no MusicBrainz (show, festival) → evento. Puro. */
export function eventoDoMB(ev: MbEvento): EventoLido | null {
  if (!ev.id || !ev.name || ev.cancelled) return null;
  const inicio = ev['life-span']?.begin;
  let quando = dataParcial(inicio);
  if (quando && ev.time && /^\d{2}:\d{2}/.test(ev.time)) {
    const [h, m] = ev.time.split(':').map(Number);
    quando = new Date(
      Date.UTC(quando.getUTCFullYear(), quando.getUTCMonth(), quando.getUTCDate(), h, m),
    );
  }
  const lugar = ev.relations?.find((r) => r['target-type'] === 'place')?.place;
  const cidade = lugar?.area?.name ?? null;
  const local = lugar?.name ? (cidade ? `${lugar.name} · ${cidade}` : lugar.name) : cidade;
  return {
    id: `musicbrainz:event:${ev.id}`,
    tipo: ev.type === 'Festival' ? 'FESTIVAL' : 'SHOW',
    titulo: ev.name,
    quando,
    local,
    cidade,
    link: `https://musicbrainz.org/event/${ev.id}`,
    fonte: 'musicbrainz',
    dados: { tipo: ev.type ?? null, inicio: inicio ?? null },
  };
}

export async function eventosMB(mbid: string, orc: Orcamento): Promise<EventoLido[]> {
  const r = await mb<{ events?: MbEvento[] }>(`event?artist=${mbid}&limit=100&inc=place-rels`, orc);
  return (r?.events ?? []).map(eventoDoMB).filter((e): e is EventoLido => e !== null);
}

// ── Wikidata ─────────────────────────────────────────────────────────────────

const WD_ENTIDADE = 'https://www.wikidata.org/wiki/Special:EntityData';
const WD_API = 'https://www.wikidata.org/w/api.php';

interface WdSnak {
  datavalue?: { value?: { id?: string; time?: string } };
}
interface WdClaim {
  mainsnak?: WdSnak;
  qualifiers?: Record<string, WdSnak[]>;
}
export interface WdEntidade {
  claims?: Record<string, WdClaim[]>;
}

export interface PremioBruto {
  premioId: string;
  obraId: string | null;
  quando: Date | null;
  indicacao: boolean;
}

/** As afirmações P166 (recebeu) e P1411 (indicado) de um item. Puro. */
export function premiosDaEntidade(entidade: WdEntidade): PremioBruto[] {
  const saida: PremioBruto[] = [];
  const ler = (chave: string, indicacao: boolean): void => {
    for (const claim of entidade.claims?.[chave] ?? []) {
      const premioId = claim.mainsnak?.datavalue?.value?.id;
      if (!premioId) continue;
      const tempo = claim.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? null;
      const obraId = claim.qualifiers?.P1686?.[0]?.datavalue?.value?.id ?? null;
      saida.push({
        premioId,
        obraId,
        quando: tempo ? dataParcial(tempo.replace(/^\+/, '')) : null,
        indicacao,
      });
    }
  };
  ler('P166', false);
  ler('P1411', true);
  return saida;
}

/** Prêmios e indicações do Wikidata, com rótulos em pt → en. */
export async function premiosWikidata(qid: string, orc: Orcamento): Promise<EventoLido[]> {
  const r = await lerJson<{ entities?: Record<string, WdEntidade> }>(
    `${WD_ENTIDADE}/${qid}.json`,
    orc,
  );
  const entidade = r?.body?.entities?.[qid];
  if (!entidade) return [];
  const brutos = premiosDaEntidade(entidade);
  if (brutos.length === 0) return [];
  const ids = [
    ...new Set(brutos.flatMap((p) => [p.premioId, p.obraId]).filter(Boolean)),
  ] as string[];
  const rotulos = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const url = `${WD_API}?action=wbgetentities&ids=${lote.join('|')}&props=labels&languages=pt-br|pt|en&format=json`;
    const l = await lerJson<{
      entities?: Record<string, { labels?: Record<string, { value?: string }> }>;
    }>(url, orc);
    for (const [id, ent] of Object.entries(l?.body?.entities ?? {})) {
      const rotulo = ent.labels?.['pt-br']?.value ?? ent.labels?.pt?.value ?? ent.labels?.en?.value;
      if (rotulo) rotulos.set(id, rotulo);
    }
  }
  const vistos = new Set<string>();
  const eventos: EventoLido[] = [];
  for (const p of brutos) {
    const premio = rotulos.get(p.premioId);
    if (!premio) continue;
    const obra = p.obraId ? (rotulos.get(p.obraId) ?? null) : null;
    const id = `wikidata:${qid}:${p.indicacao ? 'ind' : 'rec'}:${p.premioId}:${p.obraId ?? ''}:${p.quando?.toISOString().slice(0, 10) ?? ''}`;
    // O mesmo prêmio, pela mesma obra (ou sem obra), no mesmo ano, é uma linha.
    const repetido = `${premio}|${obra ?? ''}|${p.indicacao}|${p.quando?.getUTCFullYear() ?? ''}`;
    if (vistos.has(id) || vistos.has(repetido)) continue;
    vistos.add(id);
    vistos.add(repetido);
    eventos.push({
      id,
      tipo: 'PREMIO',
      titulo: premio,
      descricao: [p.indicacao ? 'Indicação' : 'Vencedor', obra ? `por "${obra}"` : null]
        .filter(Boolean)
        .join(' · '),
      quando: p.quando,
      link: `https://www.wikidata.org/wiki/${qid}`,
      fonte: 'wikidata',
      dados: { premioId: p.premioId, obraId: p.obraId, indicacao: p.indicacao },
    });
  }
  return eventos;
}

// ── Bandsintown ──────────────────────────────────────────────────────────────

interface BitEvento {
  id?: string;
  url?: string;
  datetime?: string;
  title?: string;
  artist?: { name?: string };
  venue?: { name?: string; city?: string; region?: string; country?: string };
  offers?: Array<{ type?: string; url?: string; status?: string }>;
  lineup?: string[];
}

/** Show do Bandsintown → evento. Puro. */
export function showDoBandsintown(ev: BitEvento): EventoLido | null {
  if (!ev.id || !ev.datetime) return null;
  const quando = new Date(ev.datetime);
  if (Number.isNaN(quando.getTime())) return null;
  const v = ev.venue ?? {};
  const cidade = [v.city, v.region].filter(Boolean).join(', ') || null;
  const ingresso = ev.offers?.find((o) => o.type === 'Tickets' && o.url)?.url ?? null;
  return {
    id: `bandsintown:${ev.id}`,
    tipo: (ev.lineup?.length ?? 0) > 3 ? 'FESTIVAL' : 'SHOW',
    titulo: ev.title || (v.name ? `Show em ${v.name}` : 'Show'),
    quando,
    local: v.name ? (cidade ? `${v.name} · ${cidade}` : v.name) : cidade,
    cidade,
    pais: v.country ?? null,
    linkIngresso: ingresso,
    link: ev.url ?? null,
    fonte: 'bandsintown',
    dados: { lineup: ev.lineup ?? [], status: ev.offers?.[0]?.status ?? null },
  };
}

export async function showsBandsintown(nome: string, orc: Orcamento): Promise<EventoLido[] | null> {
  if (!env.BANDSINTOWN_APP_ID) return null;
  const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(nome)}/events?app_id=${encodeURIComponent(env.BANDSINTOWN_APP_ID)}&date=upcoming`;
  const r = await lerJson<BitEvento[]>(url, orc);
  if (!r?.body || !Array.isArray(r.body)) return r ? [] : null;
  return r.body.map(showDoBandsintown).filter((e): e is EventoLido => e !== null);
}

// ── Ticketmaster ─────────────────────────────────────────────────────────────

interface TmEvento {
  id?: string;
  name?: string;
  url?: string;
  dates?: { start?: { dateTime?: string; localDate?: string } };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: Array<{ name?: string; city?: { name?: string }; country?: { countryCode?: string } }>;
    attractions?: Array<{ name?: string }>;
  };
}

function moeda(valor: number, cur: string): string {
  const simbolo = cur === 'BRL' ? 'R$' : cur === 'USD' ? 'US$' : cur === 'EUR' ? '€' : `${cur} `;
  return `${simbolo}${valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/** "R$ 120 – R$ 480" a partir das faixas de preço do Ticketmaster. Puro. */
export function faixaDePreco(ranges: TmEvento['priceRanges']): string | null {
  const validas = (ranges ?? []).filter(
    (r) => typeof r.min === 'number' || typeof r.max === 'number',
  );
  if (validas.length === 0) return null;
  const cur = validas[0]?.currency ?? 'BRL';
  const min = Math.min(...validas.map((r) => r.min ?? r.max ?? 0));
  const max = Math.max(...validas.map((r) => r.max ?? r.min ?? 0));
  return min === max ? moeda(min, cur) : `${moeda(min, cur)} – ${moeda(max, cur)}`;
}

/** Show do Ticketmaster → evento; só se o artista está na atração. Puro. */
export function showDoTicketmaster(nome: string, ev: TmEvento): EventoLido | null {
  if (!ev.id || !ev.name) return null;
  const alvo = chaveDeIdentidadeDoArtista(nome);
  const atracoes = ev._embedded?.attractions ?? [];
  if (!atracoes.some((a) => chaveDeIdentidadeDoArtista(a.name ?? '') === alvo)) return null;
  const quando = ev.dates?.start?.dateTime
    ? new Date(ev.dates.start.dateTime)
    : dataParcial(ev.dates?.start?.localDate);
  const v = ev._embedded?.venues?.[0];
  const cidade = v?.city?.name ?? null;
  return {
    id: `ticketmaster:${ev.id}`,
    tipo: atracoes.length > 3 ? 'FESTIVAL' : 'SHOW',
    titulo: ev.name,
    quando,
    local: v?.name ? (cidade ? `${v.name} · ${cidade}` : v.name) : cidade,
    cidade,
    pais: v?.country?.countryCode ?? null,
    preco: faixaDePreco(ev.priceRanges),
    linkIngresso: ev.url ?? null,
    link: ev.url ?? null,
    fonte: 'ticketmaster',
    dados: { atracoes: atracoes.map((a) => a.name) },
  };
}

export async function showsTicketmaster(
  nome: string,
  orc: Orcamento,
): Promise<EventoLido[] | null> {
  if (!env.TICKETMASTER_API_KEY) return null;
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(nome)}&classificationName=music&size=20&sort=date,asc&apikey=${encodeURIComponent(env.TICKETMASTER_API_KEY)}`;
  const r = await lerJson<{ _embedded?: { events?: TmEvento[] } }>(url, orc);
  if (!r) return null;
  return (r.body?._embedded?.events ?? [])
    .map((ev) => showDoTicketmaster(nome, ev))
    .filter((e): e is EventoLido => e !== null);
}

/**
 * O MESMO SHOW EM DUAS FONTES vira um só: mesmo dia e mesma cidade. O que
 * tem preço ganha o preço; o que tem link de ingresso ganha o link. Puro.
 */
export function fundirShows(eventos: EventoLido[]): EventoLido[] {
  const porChave = new Map<string, EventoLido>();
  const soltos: EventoLido[] = [];
  const chaveDe = (e: EventoLido): string | null => {
    if (!e.quando || (e.tipo !== 'SHOW' && e.tipo !== 'FESTIVAL')) return null;
    // Só a cidade: "São Paulo, SP" (Bandsintown) e "São Paulo" (Ticketmaster)
    // são o mesmo lugar.
    const cidade = (e.cidade ?? e.local ?? '')
      .split(/[,·]/)[0]!
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]/g, '');
    return `${e.quando.toISOString().slice(0, 10)}|${cidade}`;
  };
  for (const e of eventos) {
    const k = chaveDe(e);
    if (!k) {
      soltos.push(e);
      continue;
    }
    const atual = porChave.get(k);
    if (!atual) {
      porChave.set(k, e);
      continue;
    }
    porChave.set(k, {
      ...atual,
      preco: atual.preco ?? e.preco ?? null,
      linkIngresso: atual.linkIngresso ?? e.linkIngresso ?? null,
      local: atual.local ?? e.local ?? null,
      dados: { ...(atual.dados as object), fundidoCom: e.id },
    });
  }
  return [...porChave.values(), ...soltos];
}

// ── YouTube ──────────────────────────────────────────────────────────────────

/** Título que indica show, transmissão ou festival. */
const AO_VIVO =
  /\b(ao vivo|live|show|festival|turn[eê]|tour|rock in rio|lollapalooza|the town|transmiss[aã]o|apresenta[cç][aã]o)\b/i;

export interface VideoDoFeed {
  id: string;
  titulo: string;
  publicadoEm: string;
}

/** O feed RSS público do canal → vídeos. Puro (recebe o XML). */
export function videosDoFeed(xml: string): VideoDoFeed[] {
  const saida: VideoDoFeed[] = [];
  const entradas = xml.split('<entry>').slice(1);
  for (const e of entradas) {
    const id = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(e)?.[1];
    const titulo = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1];
    const publicadoEm = /<published>([^<]+)<\/published>/.exec(e)?.[1];
    if (id && titulo && publicadoEm) {
      saida.push({ id, titulo: decodificarXml(titulo), publicadoEm });
    }
  }
  return saida;
}

function decodificarXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Dos vídeos do canal, os que parecem show/transmissão. Puro. */
export function transmissoesDoFeed(videos: VideoDoFeed[], quantos = 3): VideoDoFeed[] {
  return videos.filter((v) => AO_VIVO.test(v.titulo)).slice(0, quantos);
}

/** Resolve `/user/x` e `/@handle` para o id do canal — só com chave. */
export async function canalPorHandle(url: string, orc: Orcamento): Promise<string | null> {
  if (!env.YOUTUBE_API_KEY) return null;
  const handle = /youtube\.com\/@([\w.-]+)/.exec(url)?.[1];
  const user = /youtube\.com\/user\/([\w.-]+)/.exec(url)?.[1];
  const custom = /youtube\.com\/c\/([\w.-]+)/.exec(url)?.[1];
  const param = handle
    ? `forHandle=${encodeURIComponent(handle)}`
    : user
      ? `forUsername=${encodeURIComponent(user)}`
      : custom
        ? `forHandle=${encodeURIComponent(custom)}`
        : null;
  if (!param) return null;
  const r = await lerJson<{ items?: Array<{ id?: string }> }>(
    `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`,
    orc,
  );
  return r?.body?.items?.[0]?.id ?? null;
}

/**
 * O vídeo PERMITE embed? O oEmbed oficial responde 200 quando sim, 401 quando
 * o dono desligou o embed e 403/404 quando é privado ou não existe.
 */
export async function permiteEmbed(videoId: string, orc: Orcamento): Promise<boolean | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const r = await lerJson<{ title?: string }>(url, orc);
  if (!r) return null;
  return r.status === 200;
}

/**
 * Transmissões do canal oficial. Com chave: ao vivo agora e agendadas (Data
 * API). Sem chave: o feed RSS do canal, filtrado por título de show.
 */
export async function transmissoesYoutube(canal: string, orc: Orcamento): Promise<EventoLido[]> {
  const eventos: EventoLido[] = [];
  if (env.YOUTUBE_API_KEY) {
    for (const tipo of ['live', 'upcoming'] as const) {
      const r = await lerJson<{
        items?: Array<{
          id?: { videoId?: string };
          snippet?: { title?: string; publishedAt?: string };
        }>;
      }>(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${canal}&eventType=${tipo}&type=video&maxResults=5&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`,
        orc,
      );
      for (const item of r?.body?.items ?? []) {
        const id = item.id?.videoId;
        if (!id) continue;
        eventos.push({
          id: `youtube:${id}`,
          tipo: 'TRANSMISSAO',
          titulo: item.snippet?.title ?? 'Transmissão',
          descricao: tipo === 'live' ? 'Ao vivo agora' : 'Transmissão agendada',
          quando: null,
          youtubeId: id,
          link: `https://www.youtube.com/watch?v=${id}`,
          fonte: 'youtube',
          dados: { estado: tipo },
        });
      }
      // Horário agendado vem em outro endpoint — vale uma chamada só se houver.
    }
    const agendados = eventos.filter((e) => (e.dados as { estado?: string }).estado === 'upcoming');
    if (agendados.length > 0) {
      const ids = agendados.map((e) => e.youtubeId).join(',');
      const r = await lerJson<{
        items?: Array<{
          id?: string;
          liveStreamingDetails?: { scheduledStartTime?: string; actualStartTime?: string };
        }>;
      }>(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${ids}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`,
        orc,
      );
      for (const item of r?.body?.items ?? []) {
        const alvo = eventos.find((e) => e.youtubeId === item.id);
        const inicio =
          item.liveStreamingDetails?.scheduledStartTime ??
          item.liveStreamingDetails?.actualStartTime;
        if (alvo && inicio) alvo.quando = new Date(inicio);
      }
    }
  } else {
    const xml = await lerTexto(`https://www.youtube.com/feeds/videos.xml?channel_id=${canal}`, orc);
    if (xml) {
      for (const v of transmissoesDoFeed(videosDoFeed(xml))) {
        eventos.push({
          id: `youtube:${v.id}`,
          tipo: 'TRANSMISSAO',
          titulo: v.titulo,
          descricao: 'Gravação publicada no canal oficial',
          quando: new Date(v.publicadoEm),
          youtubeId: v.id,
          link: `https://www.youtube.com/watch?v=${v.id}`,
          fonte: 'youtube',
          dados: { estado: 'gravado' },
        });
      }
    }
  }
  // O embed só é prometido depois de conferido — vídeo que não permite mostra
  // só local/link, como pedido.
  for (const e of eventos) {
    if (!e.youtubeId) continue;
    const ok = await permiteEmbed(e.youtubeId, orc);
    e.embed = ok === true;
  }
  return eventos;
}
