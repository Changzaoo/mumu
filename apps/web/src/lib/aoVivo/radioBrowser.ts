/**
 * Rádios do mundo inteiro, direto do Radio Browser (radio-browser.info).
 *
 * Catálogo comunitário aberto (~50 mil estações), mantido e checado pelos
 * próprios servidores deles todo dia: estação que cai some sozinha com
 * `hidebroken`, estação nova aparece sem deploy nosso. Responde com CORS
 * liberado, então o aparelho fala direto — a API do radinho não entra.
 *
 * Só estações em HTTPS: o app é servido em HTTPS e o navegador bloqueia áudio
 * `http://` (mixed content). Medido: no Brasil sobram centenas, no mundo
 * dezenas de milhares.
 */
import type { RadioStationDto } from '@radinho/shared';

/** Estação do Radio Browser no formato do app, com os extras que a tela usa. */
export interface RadioAberta extends RadioStationDto {
  countryCode: string | null;
  tags: string[];
  votos: number;
  cliques: number;
  tendencia: number;
  codec: string | null;
  bitrate: number | null;
  site: string | null;
}

export interface PaisDeRadio {
  codigo: string;
  nome: string;
  estacoes: number;
}

export interface GeneroDeRadio {
  nome: string;
  estacoes: number;
}

interface EstacaoCrua {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  votes: number;
  clickcount: number;
  clicktrend: number;
  codec: string;
  bitrate: number;
  lastcheckok: number;
}

const SERVIDOR_RESERVA = 'de1.api.radio-browser.info';
let servidor: Promise<string> | null = null;

/** Um dos espelhos oficiais, sorteado (é o que o Radio Browser pede aos clientes). */
function escolherServidor(): Promise<string> {
  servidor ??= fetch('https://all.api.radio-browser.info/json/servers')
    .then((r) => (r.ok ? (r.json() as Promise<{ name: string }[]>) : []))
    .then((lista) => {
      const nomes = [...new Set(lista.map((s) => s.name).filter(Boolean))];
      return nomes[Math.floor(Math.random() * nomes.length)] ?? SERVIDOR_RESERVA;
    })
    .catch(() => SERVIDOR_RESERVA);
  return servidor;
}

async function pedir<T>(
  caminho: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString();
  const tentar = async (host: string): Promise<T> => {
    const r = await fetch(`https://${host}/json/${caminho}${qs ? `?${qs}` : ''}`);
    if (!r.ok) throw new Error(`radio-browser ${r.status}`);
    return (await r.json()) as T;
  };
  const host = await escolherServidor();
  try {
    return await tentar(host);
  } catch (erro) {
    if (host === SERVIDOR_RESERVA) throw erro;
    servidor = Promise.resolve(SERVIDOR_RESERVA);
    return tentar(SERVIDOR_RESERVA);
  }
}

const nomesDePais =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    : null;

export function nomeDoPais(codigo: string | null | undefined, reserva = ''): string {
  if (!codigo) return reserva;
  try {
    return nomesDePais?.of(codigo.toUpperCase()) ?? reserva;
  } catch {
    return reserva || codigo;
  }
}

/** "🇧🇷" a partir de "BR". */
export function bandeira(codigo: string | null | undefined): string {
  if (!codigo || !/^[a-z]{2}$/i.test(codigo)) return '🌐';
  return String.fromCodePoint(
    ...[...codigo.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function capitalizar(texto: string): string {
  return texto.replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

function paraRadio(e: EstacaoCrua): RadioAberta {
  const tags = e.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const favicon = e.favicon?.startsWith('https://') ? e.favicon : null;
  return {
    id: e.stationuuid,
    name: e.name.trim(),
    streamUrl: e.url_resolved || e.url,
    imageUrl: favicon,
    genre: tags[0] ? capitalizar(tags[0]) : null,
    country: nomeDoPais(e.countrycode, e.country) || null,
    isLive: true,
    countryCode: e.countrycode || null,
    tags,
    votos: e.votes,
    cliques: e.clickcount,
    tendencia: e.clicktrend,
    codec: e.codec || null,
    bitrate: e.bitrate > 0 ? e.bitrate : null,
    site: e.homepage || null,
  };
}

/** Mesma rádio com vários streams (128k, 64k, AAC…): fica a mais ouvida. */
function semRepetidas(lista: RadioAberta[]): RadioAberta[] {
  const vistas = new Set<string>();
  return lista.filter((r) => {
    const chave = r.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (vistas.has(chave) || !r.streamUrl.startsWith('https://')) return false;
    vistas.add(chave);
    return true;
  });
}

export type OrdemDeRadio = 'clickcount' | 'votes' | 'clicktrend' | 'name';

export interface BuscaDeRadio {
  pais?: string | null;
  genero?: string | null;
  nome?: string | null;
  ordem?: OrdemDeRadio;
  limite?: number;
  pular?: number;
}

export async function buscarRadios(busca: BuscaDeRadio): Promise<RadioAberta[]> {
  const params: Record<string, string | number | boolean> = {
    hidebroken: true,
    is_https: true,
    order: busca.ordem ?? 'clickcount',
    reverse: (busca.ordem ?? 'clickcount') !== 'name',
    limit: busca.limite ?? 60,
    offset: busca.pular ?? 0,
  };
  if (busca.pais) params.countrycode = busca.pais.toUpperCase();
  if (busca.genero) {
    params.tag = busca.genero.toLowerCase();
    params.tagExact = false;
  }
  if (busca.nome) params.name = busca.nome;
  const cruas = await pedir<EstacaoCrua[]>('stations/search', params);
  return semRepetidas(cruas.filter((e) => e.lastcheckok !== 0).map(paraRadio));
}

export async function radiosPorId(ids: string[]): Promise<RadioAberta[]> {
  if (ids.length === 0) return [];
  const cruas = await pedir<EstacaoCrua[]>('stations/byuuid', { uuids: ids.join(',') });
  const porId = new Map(cruas.map((e) => [e.stationuuid, paraRadio(e)]));
  return ids.map((id) => porId.get(id)).filter((r): r is RadioAberta => !!r);
}

export async function paisesComRadio(): Promise<PaisDeRadio[]> {
  const crus = await pedir<{ name: string; iso_3166_1: string; stationcount: number }[]>(
    'countries',
    { hidebroken: true, order: 'stationcount', reverse: true },
  );
  return crus
    .filter((p) => /^[A-Z]{2}$/.test(p.iso_3166_1) && p.stationcount >= 3)
    .map((p) => ({
      codigo: p.iso_3166_1,
      nome: nomeDoPais(p.iso_3166_1, p.name),
      estacoes: p.stationcount,
    }));
}

export async function generosDeRadio(limite = 60): Promise<GeneroDeRadio[]> {
  const crus = await pedir<{ name: string; stationcount: number }[]>('tags', {
    hidebroken: true,
    order: 'stationcount',
    reverse: true,
    limit: limite,
  });
  return crus
    .filter((t) => t.name.length > 1 && t.name.length < 24)
    .map((t) => ({ nome: t.name, estacoes: t.stationcount }));
}

/**
 * Conta o clique no Radio Browser (é o que alimenta o "mais ouvidas" de todo
 * mundo). Fogo e esquece: falhar aqui não pode atrapalhar o som.
 */
export function contarClique(id: string): void {
  void pedir(`url/${encodeURIComponent(id)}`).catch(() => undefined);
}

/** País do aparelho ("pt-BR" → "BR"); sem região, o Brasil. */
export function paisDoAparelho(): string {
  const idiomas =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const idioma of idiomas) {
    const regiao = /[-_]([A-Za-z]{2})$/.exec(idioma)?.[1];
    if (regiao) return regiao.toUpperCase();
  }
  return 'BR';
}
