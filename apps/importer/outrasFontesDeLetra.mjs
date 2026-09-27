/**
 * outrasFontesDeLetra.mjs — letra quando o LRCLIB não tem.
 *
 * O acervo é majoritariamente brasileiro (funk, trap, rap), e boa parte dele
 * não existe no LRCLIB — ou existe só como texto puro, sem tempo. Este módulo
 * é o PLANO B: busca em fontes que o navegador não alcança sozinho (exigem
 * `Referer`/driblam CORS) e devolve, na melhor das hipóteses, uma versão COM
 * TEMPO para o app parar de cair direto na transcrição por IA — que inventa
 * texto quando o sotaque ou o autotune atrapalham.
 *
 * Fontes:
 *  - NetEase Cloud Music: busca livre + letra por id. Cobertura parcial para
 *    Brasil, mas quando tem, geralmente tem tempo.
 *  - lyrics.ovh: só texto puro, sem metadado nenhum para conferir — último
 *    recurso, e só quando título E artista são conhecidos (ver `tentarLyricsOvh`).
 *
 * A REGRA QUE MAIS IMPORTA AQUI: melhor devolver nada do que devolver a letra
 * de OUTRA música. `casaCandidato` é a mesma prova mínima que já existe para o
 * LRCLIB no cliente (`rowMatches`, em lyrics.ts) — título sozinho nunca basta;
 * precisa de artista OU duração batendo. Um cache errado aqui é permanente:
 * ninguém refaz essa busca por conta própria.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Cache em disco ao lado do módulo — sobrevive a reinícios do importador sem
 *  depender do cofre (que pode ser um diretório externo/removível). */
const CACHE_PATH = path.join(HERE, '.cache-letras-externas.json');

const FONTE_TIMEOUT_MS = 8000;

// ── normalização / prova mínima (espelha rowMatches em lyrics.ts) ──────────

/** "Chitãozinho & Xororó" vs "Chitaozinho e Xororo": o conectivo no meio quebra
 *  comparação por substring, e dupla com conectivo é comum no catálogo BR. */
const CONECTORES = new Set(['e', 'and', 'feat', 'ft', 'with', 'com', 'y']);

function normalizarTexto(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizarArtista(s) {
  return normalizarTexto(s)
    .split(' ')
    .filter((t) => t && !CONECTORES.has(t))
    .join(' ');
}

/** Tira "(feat …)", "(Ao Vivo)", "[Official Video]" etc. antes de comparar —
 *  a mesma limpeza que o cliente já faz para o LRCLIB (cleanTitleForLyrics em
 *  lyrics.ts). Duplicada aqui de propósito: são lados diferentes (browser vs
 *  Node) e o acoplamento entre processos custaria mais que estas poucas linhas. */
function limparTitulo(titulo) {
  return String(titulo ?? '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s*[-–—]\s*(?:ao\s+vivo|live|remaster(?:ed)?.*|slowed.*|sped\s*up.*)$/i, ' ')
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function tituloBate(tituloCandidato, tituloPedido) {
  const a = normalizarTexto(limparTitulo(tituloCandidato));
  const b = normalizarTexto(limparTitulo(tituloPedido));
  if (!a || !b) return false;
  // Frouxo de propósito ("Warzone" casa com "Warzone (Remix)") — e por isso
  // nunca pode bastar sozinho, ver a prova mínima no fim de `casaCandidato`.
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * `candidato` é o que a fonte devolveu (título/artistas/duração da BUSCA
 * LIVRE — texto solto, sujeito a devolver covers, remixes e homônimos).
 * `pedido` é a faixa que realmente queremos.
 *
 * Espelha `rowMatches` (apps/web/src/lib/lyrics/lyrics.ts): falta de prova é
 * reprovação. Sem isto, uma faixa sem artista conhecido e sem duração casaria
 * por título sozinho — e a letra errada entraria no cache para sempre.
 */
export function casaCandidato(candidato, pedido) {
  if (!tituloBate(candidato.titulo, pedido.titulo)) return false;

  const alvoArtista = normalizarArtista(pedido.artista);
  const artistasCandidato = (candidato.artistas ?? []).map(normalizarArtista).filter(Boolean);
  const temArtistaParaComparar = alvoArtista.length > 0 && artistasCandidato.length > 0;
  const artistaBate =
    temArtistaParaComparar &&
    artistasCandidato.some((a) => a.includes(alvoArtista) || alvoArtista.includes(a));
  if (temArtistaParaComparar && !artistaBate) return false; // artista conhecido e diferente

  const temDuracaoParaComparar = Boolean(pedido.duracaoSeg) && Boolean(candidato.duracaoSeg);
  const duracaoBate =
    temDuracaoParaComparar && Math.abs(candidato.duracaoSeg - pedido.duracaoSeg) <= 5;
  if (temDuracaoParaComparar && !duracaoBate) return false; // duração conhecida e diferente

  // PROVA MÍNIMA: título parecido não é evidência. Ou o artista bate, ou a
  // duração bate — nunca os dois ausentes ao mesmo tempo.
  return artistaBate || duracaoBate;
}

// ── NetEase Cloud Music ─────────────────────────────────────────────────────

const NETEASE_HEADERS = {
  Referer: 'https://music.163.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function neteaseBuscar(termo) {
  const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(termo)}&type=1&limit=10`;
  const res = await fetch(url, {
    headers: NETEASE_HEADERS,
    signal: AbortSignal.timeout(FONTE_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const songs = data?.result?.songs;
  return Array.isArray(songs) ? songs : [];
}

async function neteaseLetra(id) {
  const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&tv=-1`;
  const res = await fetch(url, {
    headers: NETEASE_HEADERS,
    signal: AbortSignal.timeout(FONTE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const lrc = data?.lrc?.lyric;
  return typeof lrc === 'string' && lrc.trim() ? lrc : null;
}

const TEM_TEMPO = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/;

/** Um LRC sem NENHUMA marca de tempo (raro, mas a NetEase às vezes só tem a
 *  letra crua) ainda é útil como texto puro — tira as marcas remanescentes
 *  (ex.: `[00:00.00]` isolado de metadado) e sobra só o texto. */
function lrcParaTextoPuro(lrc) {
  return lrc
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

async function tentarNetease(pedido) {
  const termo = [pedido.titulo, pedido.artista].filter(Boolean).join(' ').trim();
  if (!termo) return null;
  const songs = await neteaseBuscar(termo);
  for (const song of songs) {
    const id = song?.id;
    const titulo = song?.name;
    if (!id || typeof titulo !== 'string') continue;
    const artistas = Array.isArray(song?.artists)
      ? song.artists.map((a) => a?.name).filter((n) => typeof n === 'string')
      : [];
    const duracaoSeg = typeof song?.duration === 'number' ? Math.round(song.duration / 1000) : null;
    if (!casaCandidato({ titulo, artistas, duracaoSeg }, pedido)) continue;
    // Bateu a IDENTIDADE da faixa — mas essa faixa pode não ter letra
    // cadastrada na NetEase. Tenta o próximo candidato em vez de desistir.
    const lrc = await neteaseLetra(id).catch(() => null);
    if (!lrc) continue;
    if (TEM_TEMPO.test(lrc)) return { synced: true, lrc, fonte: 'netease' };
    const plain = lrcParaTextoPuro(lrc);
    if (plain) return { synced: false, plain, fonte: 'netease' };
  }
  return null;
}

// ── lyrics.ovh (só texto puro, sem metadado para conferir) ─────────────────

/**
 * A API resolve por artista+título direto na URL e não devolve NADA para
 * conferir a identidade da faixa (sem duração, sem título canônico de volta).
 * Por isso só entra em jogo quando os DOIS lados são conhecidos — um título
 * sozinho aqui seria aceitar de olhos fechados.
 */
async function tentarLyricsOvh(pedido) {
  if (!pedido.titulo || !pedido.artista) return null;
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(pedido.artista)}/${encodeURIComponent(pedido.titulo)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FONTE_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const texto = typeof data?.lyrics === 'string' ? data.lyrics.trim() : '';
  return texto ? { synced: false, plain: texto, fonte: 'lyrics.ovh' } : null;
}

// ── cache (memória + disco) ─────────────────────────────────────────────────
//
// Achou letra: vale o mês — a fonte não muda de um dia para o outro. Não
// achou: vale poucos dias — cobertura cresce (gente cadastra letra nova toda
// semana), e um "não achei" eterno esconderia letra que passou a existir.
const TTL_ACHADA_MS = 30 * 24 * 3600_000;
const TTL_VAZIA_MS = 3 * 24 * 3600_000;

let cache = null;
let carregando = null;

async function carregarCache() {
  if (cache) return;
  if (!carregando) {
    carregando = readFile(CACHE_PATH, 'utf8')
      .then((raw) => new Map(Object.entries(JSON.parse(raw))))
      .catch(() => new Map());
  }
  cache = await carregando;
}

let gravacaoAgendada = null;
function agendarGravacao() {
  if (gravacaoAgendada) return;
  gravacaoAgendada = setTimeout(() => {
    gravacaoAgendada = null;
    if (!cache) return;
    // Melhor esforço: sem disco, a busca só refaz na próxima consulta — não é
    // motivo para derrubar o pedido que já foi respondido ao cliente.
    writeFile(CACHE_PATH, JSON.stringify(Object.fromEntries(cache))).catch(() => undefined);
  }, 2000);
  gravacaoAgendada.unref?.();
}

function chaveCache(pedido) {
  return `${normalizarTexto(limparTitulo(pedido.titulo))}|${normalizarArtista(pedido.artista)}|${pedido.duracaoSeg || 0}`;
}

/**
 * Busca uma letra em fontes fora do LRCLIB. Devolve
 * `{ synced, lrc?, plain?, fonte }` ou `null` (nenhuma fonte tinha, ou nenhum
 * candidato bateu com segurança — nunca lança).
 */
export async function buscarOutraFonteDeLetra(pedido) {
  const titulo = String(pedido?.titulo ?? '').trim();
  if (!titulo) return null;
  const normalizado = {
    titulo,
    artista: String(pedido?.artista ?? '').trim(),
    duracaoSeg: Number(pedido?.duracaoSeg) || 0,
  };

  await carregarCache();
  const chave = chaveCache(normalizado);
  const emCache = cache.get(chave);
  if (emCache) {
    const ttl = emCache.resultado ? TTL_ACHADA_MS : TTL_VAZIA_MS;
    if (Date.now() - emCache.quando < ttl) return emCache.resultado;
  }

  let resultado = null;
  try {
    resultado = await tentarNetease(normalizado);
  } catch {
    resultado = null;
  }
  if (!resultado) {
    try {
      resultado = await tentarLyricsOvh(normalizado);
    } catch {
      resultado = null;
    }
  }

  cache.set(chave, { resultado, quando: Date.now() });
  agendarGravacao();
  return resultado;
}

// ── limite de taxa por IP ────────────────────────────────────────────────────
//
// A rota não exige login (é só texto público — LRCLIB e Wikipedia também não
// exigem), então o único freio contra abuso é este: uma janela curta com um
// teto simples por IP. Não precisa ser sofisticado — só precisa impedir que UM
// IP martele a NetEase/lyrics.ovh através do nosso servidor.
const JANELA_MS = 60_000;
const TETO_POR_JANELA = 20;
const contadores = new Map();

export function permitirRequisicaoDeLetra(ip) {
  const chave = ip || 'desconhecido';
  const agora = Date.now();
  const atual = contadores.get(chave);
  if (!atual || agora - atual.inicio > JANELA_MS) {
    contadores.set(chave, { inicio: agora, quantidade: 1 });
    return true;
  }
  if (atual.quantidade >= TETO_POR_JANELA) return false;
  atual.quantidade += 1;
  return true;
}

// Varredura periódica: sem isto, um IP que aparece uma vez e nunca mais volta
// ficaria eternamente no mapa — pequeno, mas é vazamento de memória de vida
// longa num processo que roda dias.
setInterval(() => {
  const agora = Date.now();
  for (const [chave, v] of contadores) {
    if (agora - v.inicio > JANELA_MS) contadores.delete(chave);
  }
}, JANELA_MS).unref?.();
