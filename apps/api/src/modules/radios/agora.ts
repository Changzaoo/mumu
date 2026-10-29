/**
 * O que está tocando AGORA numa rádio ao vivo — e desde quando.
 *
 * Fontes (gratuitas), na ordem:
 * 1. Triton (StreamTheWorld): API pública de "now playing" que já diz o
 *    instante em que a música começou (`cue_time_start`).
 * 2. Metadado ICY do próprio stream (Icecast/Shoutcast, `StreamTitle`). Para
 *    saber QUANDO a música começou, um vigia fica conectado ao stream enquanto
 *    alguém ouve a rádio e anota a hora de cada troca de título (os blocos de
 *    metadado chegam a cada ~1 s). A música que já tocava quando o vigia
 *    chegou fica com início desconhecido (`inicioMs: null`) até a próxima.
 *
 * Medido em 29/10/2026: ICY traz título útil em boa parte das rádios do mundo,
 * mas nas grandes do Brasil (StreamTheWorld, Zeno) vem vazio ou com o nome da
 * rádio; a Triton cobre só algumas. Rádio sem nenhuma das duas fica sem
 * identificação — reconhecer pelo som exigiria um serviço pago.
 *
 * O texto da rádio vem em mil formatos ("Artista - Música", "Música / Artista",
 * "X by Y", nome da rádio, vinheta): ele só vira música depois de CONFIRMADO no
 * catálogo da Apple (iTunes Search), que devolve também capa e duração.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { MusicaDaRadioDto } from '@radinho/shared';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ mod: 'radio-agora' });

/** Vigias ICY abertos ao mesmo tempo (cada um é um stream de ~128 kbps chegando). */
const MAX_VIGIAS = 20;
/** Sem ninguém perguntando por este tempo, o vigia desliga. */
const VIGIA_OCIOSO_MS = 90_000;
/** A primeira resposta espera o primeiro bloco de metadado até este tempo. */
const ESPERA_PRIMEIRO_TITULO_MS = 4_000;
const CACHE_TRITON_MS = 10_000;

interface Estacao {
  id: string;
  nome: string;
  url: string;
  pais: string;
}

// ── Estação: só as do Radio Browser (nada de URL arbitrária vinda do cliente) ──

const estacoes = new Map<string, { estacao: Estacao | null; em: number }>();

async function estacaoPorId(id: string): Promise<Estacao> {
  const cache = estacoes.get(id);
  if (cache && Date.now() - cache.em < 60 * 60_000) {
    if (!cache.estacao) throw new NotFoundError('Radio station');
    return cache.estacao;
  }
  const r = await fetch(
    `https://de1.api.radio-browser.info/json/stations/byuuid?uuids=${encodeURIComponent(id)}`,
    { headers: { 'User-Agent': 'radinho.online/1.0' }, signal: AbortSignal.timeout(6_000) },
  );
  if (!r.ok) throw new Error(`radio-browser ${r.status}`);
  const [e] = (await r.json()) as {
    name: string;
    url_resolved: string;
    url: string;
    countrycode: string;
  }[];
  const estacao = e
    ? {
        id,
        nome: e.name,
        url: e.url_resolved || e.url,
        pais: (e.countrycode || 'us').toLowerCase(),
      }
    : null;
  estacoes.set(id, { estacao, em: Date.now() });
  if (!estacao) throw new NotFoundError('Radio station');
  return estacao;
}

/** O servidor não pode ser usado para alcançar a rede interna (SSRF). */
function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return ipPrivado(v.slice(7));
    return (
      v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
    );
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function urlPublica(url: string): Promise<URL> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new ValidationError('stream inválido');
  const enderecos = await lookup(u.hostname, { all: true });
  if (enderecos.length === 0 || enderecos.some((e) => ipPrivado(e.address))) {
    throw new ValidationError('stream inválido');
  }
  return u;
}

/** `fetch` que confere CADA salto de redirecionamento contra a rede interna. */
async function buscarPublico(url: URL, init: RequestInit): Promise<Response> {
  let atual = url;
  for (let salto = 0; salto < 4; salto++) {
    await urlPublica(atual.href);
    const r = await fetch(atual, { ...init, redirect: 'manual' });
    const destino = r.headers.get('location');
    if (r.status < 300 || r.status >= 400 || !destino) return r;
    void r.body?.cancel();
    atual = new URL(destino, atual);
  }
  throw new ValidationError('redirecionamentos demais');
}

// ── Triton (StreamTheWorld) ─────────────────────────────────────────

interface Leitura {
  bruto: string;
  inicioMs: number | null;
  fonte: 'icy' | 'triton';
}

const triton = new Map<string, { leitura: Leitura | null; em: number }>();

function montagemTriton(url: URL): string[] {
  if (!/streamtheworld\.com$/i.test(url.hostname)) return [];
  const ultimo = url.pathname.split('/').pop() ?? '';
  const mount = ultimo.replace(/\.(aac|mp3|m3u8)$/i, '');
  if (!/^[A-Z0-9_]+$/i.test(mount)) return [];
  const sem = mount.replace(/(AAC|_ADP|_SC)$/i, '');
  return sem && sem !== mount ? [mount, sem] : [mount];
}

function propriedade(xml: string, nome: string): string | null {
  const m = new RegExp(`name="${nome}"><!\\[CDATA\\[([^\\]]*)\\]\\]>`).exec(xml);
  return m?.[1]?.trim() || null;
}

async function lerTriton(url: URL): Promise<Leitura | null> {
  const montagens = montagemTriton(url);
  if (montagens.length === 0) return null;
  const chave = montagens[0]!;
  const cache = triton.get(chave);
  if (cache && Date.now() - cache.em < CACHE_TRITON_MS) return cache.leitura;
  let leitura: Leitura | null = null;
  for (const mount of montagens) {
    try {
      const r = await fetch(
        `https://np.tritondigital.com/public/nowplaying?mountName=${mount}&numberToFetch=1&eventType=track`,
        { signal: AbortSignal.timeout(5_000) },
      );
      const xml = await r.text();
      const titulo = propriedade(xml, 'cue_title');
      const artista = propriedade(xml, 'track_artist_name');
      if (titulo && artista) {
        const inicio = Number(propriedade(xml, 'cue_time_start'));
        leitura = {
          bruto: `${artista} - ${titulo}`,
          inicioMs: Number.isFinite(inicio) && inicio > 0 ? inicio : null,
          fonte: 'triton',
        };
        break;
      }
    } catch {
      /* tenta a próxima montagem */
    }
  }
  triton.set(chave, { leitura, em: Date.now() });
  return leitura;
}

// ── Vigia ICY ───────────────────────────────────────────────────────

class Vigia {
  bruto: string | null = null;
  /** Hora (servidor) em que o título atual apareceu; null = já tocava quando chegamos. */
  desde: number | null = null;
  semMetadado = false;
  ultimoPedido = Date.now();
  readonly pronto: Promise<void>;
  private avisarPronto!: () => void;
  private readonly abort = new AbortController();

  constructor(private readonly url: URL) {
    this.pronto = new Promise((r) => (this.avisarPronto = r));
    void this.ler();
  }

  fechar(): void {
    this.abort.abort();
    this.avisarPronto();
  }

  private trocou(titulo: string): void {
    if (titulo === this.bruto) return;
    // O primeiro título é o da música que JÁ tocava: início desconhecido.
    this.desde = this.bruto === null ? null : Date.now();
    this.bruto = titulo;
    this.avisarPronto();
  }

  private async ler(): Promise<void> {
    try {
      const r = await buscarPublico(this.url, {
        headers: { 'Icy-MetaData': '1', 'User-Agent': 'radinho.online/1.0' },
        signal: this.abort.signal,
      });
      const metaint = Number(r.headers.get('icy-metaint'));
      if (!r.ok || !r.body || !Number.isFinite(metaint) || metaint <= 0) {
        this.semMetadado = true;
        this.fechar();
        return;
      }
      let fase: 'audio' | 'tamanho' | 'meta' = 'audio';
      let falta = metaint;
      let pedacos: Buffer[] = [];
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        const c = Buffer.from(chunk);
        let i = 0;
        while (i < c.length) {
          if (fase === 'audio') {
            const n = Math.min(falta, c.length - i);
            i += n;
            falta -= n;
            if (falta === 0) fase = 'tamanho';
          } else if (fase === 'tamanho') {
            falta = c[i++]! * 16;
            if (falta > 0) {
              fase = 'meta';
              pedacos = [];
            } else {
              fase = 'audio';
              falta = metaint;
            }
          } else {
            const n = Math.min(falta, c.length - i);
            pedacos.push(c.subarray(i, i + n));
            i += n;
            falta -= n;
            if (falta === 0) {
              const texto = Buffer.concat(pedacos).toString('utf8');
              const m = /StreamTitle='(.*?)';/s.exec(texto);
              if (m) this.trocou(m[1]!.trim());
              fase = 'audio';
              falta = metaint;
            }
          }
        }
      }
    } catch (erro) {
      if (!this.abort.signal.aborted)
        log.debug({ erro: String(erro), url: this.url.host }, 'vigia caiu');
    } finally {
      this.semMetadado ||= this.bruto === null;
      this.fechar();
      vigias.delete(this.url.href);
    }
  }
}

const vigias = new Map<string, Vigia>();

setInterval(() => {
  const agora = Date.now();
  for (const [chave, v] of vigias) {
    if (agora - v.ultimoPedido > VIGIA_OCIOSO_MS) {
      v.fechar();
      vigias.delete(chave);
    }
  }
}, 30_000).unref();

/** Stream que já mostrou não ter metadado: não reabre por um tempo. */
const semIcy = new Map<string, number>();

async function lerIcy(url: URL): Promise<Leitura | null> {
  const chave = url.href;
  if ((semIcy.get(chave) ?? 0) > Date.now()) return null;
  let v = vigias.get(chave);
  if (!v) {
    if (vigias.size >= MAX_VIGIAS) return null;
    v = new Vigia(url);
    vigias.set(chave, v);
  }
  v.ultimoPedido = Date.now();
  await Promise.race([v.pronto, new Promise((r) => setTimeout(r, ESPERA_PRIMEIRO_TITULO_MS))]);
  if (v.semMetadado) {
    semIcy.set(chave, Date.now() + 10 * 60_000);
    return null;
  }
  return v.bruto ? { bruto: v.bruto, inicioMs: v.desde, fonte: 'icy' } : null;
}

// ── Confirmação no catálogo ─────────────────────────────────────────

type Musica = NonNullable<MusicaDaRadioDto['musica']>;

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length > 0);
}

/** Quanto de `parte` aparece em `todo` (0..1). */
function cobertura(parte: string[], todo: Set<string>): number {
  if (parte.length === 0) return 0;
  return parte.filter((p) => todo.has(p)).length / parte.length;
}

/** Título "limpo": sem (feat. …), [Remaster], " - Radio Edit". */
function tituloBase(titulo: string): string {
  return titulo.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '');
}

const confirmadas = new Map<string, { musica: Musica | null; em: number }>();

function pareceLixo(bruto: string, estacao: Estacao): boolean {
  const n = normalizar(bruto);
  if (n.length < 4 || !/\p{L}/u.test(n) || /https?|www\b/.test(bruto)) return true;
  const nomeDaRadio = normalizar(estacao.nome);
  return (
    n === nomeDaRadio || nomeDaRadio.includes(n) || /^(unknown|now playing|desconhecido)/.test(n)
  );
}

async function confirmar(bruto: string, estacao: Estacao): Promise<Musica | null> {
  if (pareceLixo(bruto, estacao)) return null;
  const chave = normalizar(bruto);
  const cache = confirmadas.get(chave);
  if (cache && Date.now() - cache.em < 24 * 60 * 60_000) return cache.musica;

  const termo = normalizar(bruto.replace(/\s+by\s+/i, ' ').replace(/\s*\/\s*/g, ' ')).slice(0, 80);
  const lojas = [...new Set([estacao.pais, 'us'])];
  const doBruto = new Set(palavras(bruto));
  let melhor: { musica: Musica; nota: number } | null = null;
  for (const loja of lojas) {
    try {
      const qs = new URLSearchParams({ term: termo, entity: 'song', limit: '10', country: loja });
      const r = await fetch(`https://itunes.apple.com/search?${qs}`, {
        signal: AbortSignal.timeout(6_000),
      });
      if (!r.ok) continue;
      const dados = (await r.json()) as {
        results: {
          trackName: string;
          artistName: string;
          artworkUrl100?: string;
          trackTimeMillis?: number;
        }[];
      };
      for (const x of dados.results) {
        const titulo = palavras(tituloBase(x.trackName));
        const artista = palavras(
          x.artistName.split(/,|&| feat\.? | ft\.? | e | x /i)[0] ?? x.artistName,
        );
        const ct = cobertura(titulo, doBruto);
        const ca = cobertura(artista, doBruto);
        if (ct < 0.8 || ca < 0.6) continue;
        const nota = ct * 2 + ca;
        if (!melhor || nota > melhor.nota) {
          melhor = {
            nota,
            musica: {
              titulo: tituloBase(x.trackName) || x.trackName,
              artista: x.artistName,
              capaUrl: x.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/600x600bb.') ?? null,
              duracaoMs: x.trackTimeMillis ?? 0,
            },
          };
        }
      }
      if (melhor) break;
    } catch {
      /* tenta a próxima loja */
    }
  }
  const musica = melhor?.musica ?? null;
  if (confirmadas.size > 2_000) confirmadas.clear();
  confirmadas.set(chave, { musica, em: Date.now() });
  return musica;
}

// ── Ponto de entrada ────────────────────────────────────────────────

export async function musicaAgora(estacaoId: string): Promise<MusicaDaRadioDto> {
  const estacao = await estacaoPorId(estacaoId);
  const url = await urlPublica(estacao.url);
  const leitura = (await lerTriton(url)) ?? (await lerIcy(url));
  const musica = leitura ? await confirmar(leitura.bruto, estacao) : null;
  return {
    musica,
    inicioMs: musica ? (leitura?.inicioMs ?? null) : null,
    bruto: leitura?.bruto ?? null,
    fonte: leitura?.fonte ?? null,
    agoraMs: Date.now(),
  };
}
