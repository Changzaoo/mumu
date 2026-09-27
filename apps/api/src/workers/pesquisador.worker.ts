/**
 * O AGENTE PESQUISADOR — 24/7, NO SERVIDOR.
 *
 * Antes ele vivia no navegador: só trabalhava com o app aberto, e o interruptor
 * que o ligava ficava no aparelho em que foi ligado ("nunca fica ligado"). Agora
 * a escolha mora na conta (`User.settings.pesquisadorAtivo`, ver
 * apps/web/src/lib/sync/ajustesDaConta.ts) e o trabalho acontece aqui, com
 * todos os aparelhos fechados.
 *
 * O QUE ELE FAZ, a cada batida, para cada pessoa que ligou:
 *   1. GOSTO — os artistas que ela mais ouve (telemetria de cada aparelho) e
 *      curte (curtida pesa 3), menos os que ela já tem de sobra no acervo;
 *   2. BUSCA — pelo importador (`/buscar-youtube`), só vídeos DO artista
 *      (nome no título ou no canal), sem versões mexidas (speed up, 8D…) e com
 *      duração de música;
 *   3. NOVIDADE — descarta o que o acervo (catálogo ou biblioteca dela) já tem,
 *      pelo link e por "artista|título";
 *   4. BAIXA — o importador baixa, o cofre guarda (com a origem, para a poda
 *      ser reversível), e a faixa entra no catálogo E na biblioteca dela — a
 *      sincronia leva para todos os aparelhos;
 *   5. LETRA — busca a letra no LRCLIB e já pede o ALINHAMENTO ao áudio (a
 *      letra chega sincronizada palavra por palavra na primeira vez que tocar);
 *      sem letra publicada, já deixa a transcrição na fila do importador.
 *
 * FREIOS: poucas faixas por batida e um teto por dia (o YouTube recua quando vê
 * rajada, e o importador serve o áudio de quem está ouvindo agora); um artista
 * não é pesquisado de novo por algumas horas; sem folga no cofre, a batida é
 * pulada e o log diz por quê — agente parado que explica é melhor que agente
 * ocupado que não progride (ver varreduraNoturna.worker).
 */
import { randomUUID } from 'node:crypto';
import { lerTituloDoAcervo } from '@radinho/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';
import {
  baixar,
  baseInterna,
  cabecalhos,
  folgaDoCofre,
  guardarNoCofre,
} from './varreduraNoturna.worker.js';

const log = logger.child({ worker: 'pesquisador' });

/** Artistas investigados por pessoa por batida. */
const ARTISTAS_POR_BATIDA = 2;
/** Faixas novas por artista por batida. */
const NOVAS_POR_ARTISTA = 2;
/** Um artista pesquisado descansa este tanto antes de ser pesquisado de novo. */
const DESCANSO_DO_ARTISTA_MS = 6 * 3600_000;
/** Quem já tem tantas faixas do artista no acervo não precisa de mais agora. */
const JA_TEM_O_BASTANTE = 25;
/** Duração de música (s): fora disso é trecho, short, mix ou show. */
const DURACAO_MIN_S = 90;
const DURACAO_MAX_S = 8 * 60;
/** Folga mínima no cofre (bytes) para baixar faixa nova. */
const FOLGA_MINIMA = 200 * 1024 * 1024;

const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|cover|reac(?:t|tion|ting)|reagindo|tutorial|aula|remix|ao vivo|live)\b/i;

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

export function idDoVideo(url: string): string | null {
  const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url) ?? /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  return m?.[1] ?? null;
}

export interface ResultadoDaBusca {
  url: string;
  titulo: string;
  canal: string;
  duracaoSeg: number;
  capa: string | null;
}

/**
 * O resultado é uma música DESTE artista que vale trazer? Devolve título e
 * artistas limpos, ou null. Puro (testável).
 */
export function faixaDoResultado(
  artista: string,
  r: ResultadoDaBusca,
): { title: string; artists: string[] } | null {
  const alvo = norm(artista);
  if (alvo.length < 2) return null;
  if (!(norm(r.titulo).includes(alvo) || norm(r.canal).includes(alvo))) return null;
  if (VERSAO_ALTERADA.test(`${r.titulo} ${r.canal}`)) return null;
  if (!(r.duracaoSeg >= DURACAO_MIN_S && r.duracaoSeg <= DURACAO_MAX_S)) return null;
  const lido = lerTituloDoAcervo(r.titulo, [artista]);
  if (lido?.title) return { title: lido.title, artists: lido.artists };
  // Sem o leitor do acervo: "ARTISTA - MÚSICA (Clipe Oficial)" → "MÚSICA".
  const partes = r.titulo.split(/\s[-–—|]\s/);
  const bruto = partes.length >= 2 ? partes.slice(1).join(' - ') : r.titulo;
  const title = bruto
    .replace(
      /[([][^)\]]*(?:oficial|official|clipe|video|vídeo|audio|áudio|lyric|visualizer)[^)\]]*[)\]]/gi,
      ' ',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  return title ? { title, artists: [artista] } : null;
}

/**
 * Quem pesquisar para esta pessoa: muito ouvido/curtido e pouco presente no
 * acervo dela. Puro (testável).
 */
export function escolherArtistas(
  ouvidos: ReadonlyMap<string, number>,
  naBiblioteca: ReadonlyMap<string, number>,
  descansando: (artista: string) => boolean,
  quantos = ARTISTAS_POR_BATIDA,
): string[] {
  return [...ouvidos.entries()]
    .filter(([nome]) => norm(nome).length >= 2 && !descansando(nome))
    .map(([nome, peso]) => {
      const tem = naBiblioteca.get(norm(nome)) ?? 0;
      return { nome, nota: tem >= JA_TEM_O_BASTANTE ? 0 : peso / (1 + tem / 5) };
    })
    .filter((a) => a.nota > 0)
    .sort((a, b) => b.nota - a.nota)
    .slice(0, quantos)
    .map((a) => a.nome);
}

async function usuariosQueLigaram(): Promise<string[]> {
  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User" WHERE settings->>'pesquisadorAtivo' = 'true' AND "isBanned" = false
  `;
  return linhas.map((l) => l.id);
}

/** Artistas ouvidos (telemetria de todos os aparelhos) e curtidos (peso 3). */
async function gostoDe(userId: string): Promise<Map<string, number>> {
  const peso = new Map<string, number>();
  const somar = (nome: unknown, v: number): void => {
    if (typeof nome !== 'string' || !nome.trim() || nome === 'Desconhecido') return;
    peso.set(nome.trim(), (peso.get(nome.trim()) ?? 0) + v);
  };
  const aparelhos = await prisma.$queryRaw<Array<{ top: unknown }>>`
    SELECT data->'topArtists' AS top FROM "TelemetryDevice" WHERE "userId" = ${userId}
  `;
  for (const a of aparelhos) {
    if (!Array.isArray(a.top)) continue;
    for (const item of a.top as Array<{ name?: unknown; plays?: unknown }>) {
      somar(item?.name, Number(item?.plays) || 0);
    }
  }
  const curtidas = await prisma.$queryRaw<Array<{ nome: string | null }>>`
    SELECT data->'track'->'artists'->0->>'name' AS nome FROM "UserCollectionItem"
    WHERE "userId" = ${userId} AND collection = 'likes' AND deleted = false
  `;
  for (const c of curtidas) somar(c.nome, 3);
  return peso;
}

interface JaTem {
  chaves: Set<string>;
  videos: Set<string>;
  porArtista: Map<string, number>;
}

/** O que o acervo (catálogo + biblioteca da pessoa) já tem — sem o `dna`. */
async function oQueJaTem(userId: string): Promise<JaTem> {
  const linhas = await prisma.$queryRaw<
    Array<{ titulo: string | null; artista: string | null; origem: string | null }>
  >`
    SELECT data->'track'->>'title' AS titulo, data->'track'->'artists'->0->>'name' AS artista,
           data->>'sourceUrl' AS origem
    FROM "CatalogTrack"
    UNION ALL
    SELECT data->'track'->>'title', data->'track'->'artists'->0->>'name', data->>'sourceUrl'
    FROM "UserCollectionItem"
    WHERE "userId" = ${userId} AND collection = 'library' AND deleted = false
  `;
  const chaves = new Set<string>();
  const videos = new Set<string>();
  const porArtista = new Map<string, number>();
  for (const l of linhas) {
    if (l.artista && l.titulo) chaves.add(chaveDaMusica(l.artista, l.titulo));
    if (l.origem) {
      const v = idDoVideo(l.origem);
      if (v) videos.add(v);
    }
    if (l.artista) porArtista.set(norm(l.artista), (porArtista.get(norm(l.artista)) ?? 0) + 1);
  }
  return { chaves, videos, porArtista };
}

async function buscar(termo: string): Promise<ResultadoDaBusca[]> {
  const res = await fetch(`${baseInterna()}/buscar-youtube?q=${encodeURIComponent(termo)}`, {
    headers: cabecalhos(),
  });
  if (!res.ok) throw new Error(`busca respondeu ${res.status}`);
  const dados = (await res.json()) as { resultados?: ResultadoDaBusca[] };
  return Array.isArray(dados.resultados) ? dados.resultados : [];
}

/** Idioma provável da letra: inglês pelas palavras mais comuns, senão pt. */
export function idiomaDaLetra(texto: string): 'en' | 'pt' {
  const palavras = norm(texto).split(' ');
  if (palavras.length === 0) return 'pt';
  const en = new Set(['the', 'you', 'and', 'i', 'me', 'my', 'is', 'it', 'to', 'in', 'on', 'that']);
  const pt = new Set(['que', 'eu', 'voce', 'nao', 'de', 'e', 'o', 'a', 'me', 'com', 'pra', 'se']);
  let nEn = 0;
  let nPt = 0;
  for (const p of palavras) {
    if (en.has(p)) nEn++;
    if (pt.has(p)) nPt++;
  }
  return nEn > nPt * 1.5 ? 'en' : 'pt';
}

/** Letra do LRCLIB (exata por título/artista/duração), como linhas de texto. */
async function letraDe(
  titulo: string,
  artista: string,
  duracaoSeg: number,
): Promise<string[] | null> {
  const url = new URL('https://lrclib.net/api/get');
  url.searchParams.set('track_name', titulo);
  url.searchParams.set('artist_name', artista);
  url.searchParams.set('duration', String(Math.round(duracaoSeg)));
  const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null);
  if (!res?.ok) return null;
  const row = (await res.json().catch(() => null)) as {
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
    duration?: number;
  } | null;
  if (!row) return null;
  if (typeof row.duration === 'number' && Math.abs(row.duration - duracaoSeg) > 4) return null;
  const texto = row.plainLyrics || row.syncedLyrics?.replace(/\[[^\]]*\]/g, '') || '';
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return linhas.length > 0 ? linhas : null;
}

/** Deixa a letra pronta: alinhamento (com letra) ou transcrição (sem). */
async function prepararLetra(
  id: string,
  token: string,
  titulo: string,
  artista: string,
  duracaoSeg: number,
): Promise<'alinhando' | 'transcrevendo' | 'falhou'> {
  const base = `${baseInterna()}/blob/${encodeURIComponent(id)}`;
  try {
    const linhas = await letraDe(titulo, artista, duracaoSeg);
    if (linhas) {
      const lang = idiomaDaLetra(linhas.join(' '));
      const res = await fetch(`${base}/alinhar?k=${encodeURIComponent(token)}&lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas }),
      });
      return res.ok || res.status === 202 ? 'alinhando' : 'falhou';
    }
    const res = await fetch(`${base}/tempo?k=${encodeURIComponent(token)}&lang=auto`);
    return res.ok || res.status === 202 ? 'transcrevendo' : 'falhou';
  } catch {
    return 'falhou';
  }
}

/** Baixa, guarda, registra no catálogo e na biblioteca, e prepara a letra. */
async function trazer(
  userId: string,
  r: ResultadoDaBusca,
  faixa: { title: string; artists: string[] },
): Promise<boolean> {
  const { ok } = await baixar(r.url);
  if (!ok) return false;
  const id = `local:${randomUUID()}`;
  const guardada = await guardarNoCofre(id, ok, r.url);
  if (!guardada.remoteUrl) return false;
  const token = new URL(guardada.remoteUrl).searchParams.get('k') ?? '';
  const agora = new Date().toISOString();
  const entry: CatalogEntry = {
    track: {
      id,
      album: null,
      label: null,
      title: faixa.title,
      artists: faixa.artists.map((name, i) => ({
        id: `local-artist:${id}:${i}`,
        name,
        slug: '',
        imageUrl: null,
      })),
      composer: null,
      coverUrl: r.capa,
      explicit: false,
      streamUrl: guardada.remoteUrl,
      discNumber: null,
      durationMs: r.duracaoSeg * 1000,
      playsCount: 0,
      downloadUrl: null,
      releaseYear: null,
      trackNumber: null,
      loudnessLufs: null,
      dominantColor: null,
      uploadedByUserId: null,
    },
    addedAt: agora,
    mimeType: ok.tipo,
    sizeBytes: ok.bytes.length,
    sourceUrl: r.url,
    remoteUrl: guardada.remoteUrl,
    /** Quem trouxe: o agente, para a pessoa (e a curadoria) saberem. */
    origemDoAgente: 'pesquisador',
  };
  await upsertCatalogTrack(id, entry);
  await prisma.userCollectionItem.upsert({
    where: { userId_collection_itemId: { userId, collection: 'library', itemId: id } },
    create: { userId, collection: 'library', itemId: id, data: entry as object },
    update: { data: entry as object, deleted: false },
  });
  const letra = await prepararLetra(id, token, faixa.title, faixa.artists[0] ?? '', r.duracaoSeg);
  log.info(
    { userId, id, titulo: faixa.title, artista: faixa.artists[0], letra },
    'faixa nova trazida',
  );
  return true;
}

/** Artista → quando foi pesquisado (em memória: um reinício só adianta a vez). */
const pesquisadoEm = new Map<string, number>();
/** Faixas trazidas hoje (teto diário). */
let dia = '';
let trazidasHoje = 0;

export async function pesquisarUmaVez(agora = new Date()): Promise<{
  rodou: boolean;
  motivo?: string;
  trazidas: number;
}> {
  const parado = (motivo: string) => ({ rodou: false, motivo, trazidas: 0 });
  if (!baseInterna()) return parado('IMPORTER_URL não configurado');
  if (!env.IMPORT_SERVICE_TOKEN) return parado('IMPORT_SERVICE_TOKEN não configurado');

  const hoje = agora.toISOString().slice(0, 10);
  if (hoje !== dia) {
    dia = hoje;
    trazidasHoje = 0;
  }
  if (trazidasHoje >= env.PESQUISADOR_MAX_POR_DIA) return parado('teto do dia alcançado');

  const usuarios = await usuariosQueLigaram();
  if (usuarios.length === 0) return parado('ninguém ligou o agente');

  const livre = await folgaDoCofre();
  if (livre === null) return parado('cofre não respondeu');
  if (livre < FOLGA_MINIMA) return parado(`cofre sem folga (${Math.round(livre / 1e6)} MB)`);

  let trazidas = 0;
  const tetoDaBatida = env.PESQUISADOR_POR_BATIDA;
  for (const userId of usuarios) {
    if (trazidas >= tetoDaBatida || trazidasHoje >= env.PESQUISADOR_MAX_POR_DIA) break;
    const [gosto, jaTem] = await Promise.all([gostoDe(userId), oQueJaTem(userId)]);
    const t = agora.getTime();
    const artistas = escolherArtistas(gosto, jaTem.porArtista, (nome) => {
      const em = pesquisadoEm.get(norm(nome));
      return em !== undefined && t - em < DESCANSO_DO_ARTISTA_MS;
    });
    for (const artista of artistas) {
      pesquisadoEm.set(norm(artista), t);
      let resultados: ResultadoDaBusca[];
      try {
        resultados = await buscar(artista);
      } catch (err) {
        log.warn({ artista, err: String(err) }, 'busca falhou');
        continue;
      }
      let doArtista = 0;
      for (const r of resultados) {
        if (doArtista >= NOVAS_POR_ARTISTA || trazidas >= tetoDaBatida) break;
        const video = idDoVideo(r.url);
        if (!video || jaTem.videos.has(video)) continue;
        const faixa = faixaDoResultado(artista, r);
        if (!faixa) continue;
        const chave = chaveDaMusica(faixa.artists[0] ?? artista, faixa.title);
        if (jaTem.chaves.has(chave)) continue;
        jaTem.videos.add(video);
        jaTem.chaves.add(chave);
        const deuCerto = await trazer(userId, r, faixa).catch((err: unknown) => {
          log.warn({ url: r.url, err: String(err) }, 'não deu para trazer a faixa');
          return false;
        });
        if (deuCerto) {
          doArtista++;
          trazidas++;
          trazidasHoje++;
        }
      }
    }
  }
  return { rodou: true, trazidas };
}

export function startPesquisadorWorker(): () => void {
  if (!baseInterna() || !env.IMPORT_SERVICE_TOKEN || !env.PESQUISADOR_ENABLED) {
    logger.info(
      {
        importerUrl: Boolean(baseInterna()),
        token: Boolean(env.IMPORT_SERVICE_TOKEN),
        ligado: env.PESQUISADOR_ENABLED,
      },
      'agente pesquisador desligado',
    );
    return () => undefined;
  }
  let parado = false;
  let rodando = false;
  const bater = (): void => {
    if (parado || rodando) return;
    rodando = true;
    void pesquisarUmaVez()
      .then((r) => {
        if (!r.rodou) log.info({ motivo: r.motivo }, 'pesquisador declinou esta batida');
        else log.info({ trazidas: r.trazidas }, 'pesquisador terminou a batida');
      })
      .catch((err) => log.error({ err }, 'pesquisador falhou'))
      .finally(() => {
        rodando = false;
      });
  };
  // Primeira batida logo depois de subir (sem esperar a primeira janela).
  const primeira = setTimeout(bater, 60_000);
  const timer = setInterval(bater, env.PESQUISADOR_BATIDA_MIN * 60_000);
  primeira.unref?.();
  timer.unref?.();
  logger.info({ batidaMin: env.PESQUISADOR_BATIDA_MIN }, 'agente pesquisador 24/7 iniciado');
  return () => {
    parado = true;
    clearTimeout(primeira);
    clearInterval(timer);
  };
}
