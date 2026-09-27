/**
 * BUSCA NO YOUTUBE PARA QUEM NÃO ACHOU NO ACERVO — `GET /buscar-youtube?q=`.
 *
 * A pessoa digita uma música que ninguém importou ainda, e a busca voltava
 * vazia. O importador já sabe tocar ao vivo (`/stream`) e já sabe trazer para a
 * biblioteca (fila de import); faltava só a ponte: descobrir QUAL vídeo é a
 * música. Este módulo é essa ponte, e nada além dela — devolve candidatos, não
 * baixa um byte de áudio.
 *
 * POR QUE `--flat-playlist`. A busca completa abriria cada vídeo (a página, o
 * player JS, os formatos): 10 resultados virariam 10 extrações de 5-15 s cada,
 * e seria justamente o volume que faz o YouTube pedir "confirme que não é um
 * robô" para o IP inteiro — derrubando junto o `/stream` de quem está ouvindo.
 * A lista plana vem numa página só, em 1-3 s, e já traz título, canal e
 * duração, que é tudo o que a tela precisa.
 *
 * Separado do server.mjs para o parse e os filtros serem testáveis sem subir
 * processo nenhum: `parseResultados` é função pura.
 */
import { spawn } from 'node:child_process';

/** Música de verdade raramente tem menos de 1 min (é vinheta, short, trecho). */
export const DURACAO_MIN_SEG = 60;
/** Mais de 15 min é mix, álbum inteiro, show ou "1 hora de…" — não uma faixa. */
export const DURACAO_MAX_SEG = 15 * 60;

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_TERMOS = 500;
/** Por quem pergunta: 10 buscas NOVAS por minuto é folga para quem digita. */
const LIMITE_POR_JANELA = 10;
const JANELA_MS = 60_000;
/** yt-dlp simultâneos só desta rota — o resto do importador precisa de CPU. */
const MAX_SIMULTANEAS = 3;
const TIMEOUT_MS = 25_000;
const TERMO_MAX = 120;

const ID_VIDEO = /^[A-Za-z0-9_-]{11}$/;

/** Espaços colapsados, tamanho limitado. Vazio = não há o que buscar. */
export function normalizarTermo(termo) {
  return String(termo ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TERMO_MAX);
}

/**
 * O yt-dlp às vezes manda a lista de miniaturas, às vezes nada. A do
 * `i.ytimg.com/vi/<id>/hqdefault.jpg` existe para todo vídeo público e não
 * expira — a das miniaturas vem com assinatura que caduca em horas, e capa
 * quebrada na tela é pior do que a genérica.
 */
function capaDe(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * Uma entrada da lista plana parece música que dá para tocar?
 *
 * Live (em curso ou agendada) não tem fim e o `/stream` não sabe o que fazer
 * com ela; sem duração quase sempre é live também. Os limites de duração tiram
 * shorts e compilações — ver as constantes.
 */
export function pareceMusica(entrada) {
  if (!entrada || typeof entrada !== 'object') return false;
  const live = entrada.live_status;
  if (live === 'is_live' || live === 'is_upcoming' || live === 'post_live') return false;
  if (entrada.is_live === true) return false;
  const duracao = Number(entrada.duration);
  if (!Number.isFinite(duracao) || duracao <= 0) return false;
  if (duracao < DURACAO_MIN_SEG || duracao > DURACAO_MAX_SEG) return false;
  // Canal ou playlist no meio dos resultados: não é um vídeo.
  const ie = String(entrada.ie_key ?? '');
  if (ie && ie !== 'Youtube') return false;
  if (typeof entrada.url === 'string' && /\/shorts\//.test(entrada.url)) return false;
  return true;
}

/**
 * JSON do `yt-dlp -J --flat-playlist ytsearchN:` → lista enxuta para a tela.
 * Aceita o texto cru ou o objeto já lido; entrada estranha vira lista vazia
 * (nunca lança — a rota responde "nada achado", não 500).
 */
export function parseResultados(bruto) {
  let dados = bruto;
  if (typeof bruto === 'string') {
    try {
      dados = JSON.parse(bruto);
    } catch {
      return [];
    }
  }
  const entradas = Array.isArray(dados?.entries) ? dados.entries : [];
  const vistos = new Set();
  const resultados = [];
  for (const e of entradas) {
    if (!pareceMusica(e)) continue;
    const id = typeof e.id === 'string' ? e.id : '';
    // A URL é SEMPRE remontada a partir do id: a da lista plana pode vir como
    // /shorts/, youtu.be ou só o id, e o `hostSupported` do /stream e o dedupe
    // da fila de import comparam o texto do link.
    if (!ID_VIDEO.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    const titulo = typeof e.title === 'string' ? e.title.trim() : '';
    if (!titulo) continue;
    const canal = [e.channel, e.uploader].find((c) => typeof c === 'string' && c.trim());
    resultados.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      titulo,
      canal: canal ? canal.trim() : '',
      duracaoSeg: Math.round(Number(e.duration)),
      capa: capaDe(id),
    });
  }
  return resultados;
}

/** Roda o yt-dlp e devolve o stdout (JSON). Rejeita com o fim do stderr. */
function rodarYtdlpPadrao({ binario, argsExtras }) {
  return (termo, quantos) =>
    new Promise((resolve, reject) => {
      const args = [
        '--flat-playlist',
        '--no-warnings',
        '-J',
        ...argsExtras(),
        `ytsearch${quantos}:${termo}`,
      ];
      const p = spawn(binario(), args, { windowsHide: true });
      let out = '';
      let err = '';
      const relogio = setTimeout(() => p.kill(), TIMEOUT_MS);
      p.stdout.on('data', (c) => {
        out += c;
        if (out.length > 5_000_000) p.kill(); // busca não tem por que ser maior
      });
      p.stderr.on('data', (c) => {
        err += c;
        if (err.length > 4096) err = err.slice(-4096);
      });
      p.on('error', (e) => {
        clearTimeout(relogio);
        reject(e);
      });
      p.on('close', (code) => {
        clearTimeout(relogio);
        if (code === 0) resolve(out);
        else reject(new Error(err.trim().split('\n').pop() || `yt-dlp saiu com ${code}`));
      });
    });
}

export class LimiteDeBusca extends Error {
  constructor(esperarSeg) {
    super('Muitas buscas seguidas. Espere um pouco.');
    this.esperarSeg = esperarSeg;
  }
}

/**
 * A busca com cache, limite por usuário e teto de simultaneidade.
 *
 * `rodar(termo, quantos)` pode ser injetado (testes); o padrão chama o yt-dlp
 * com `binario()` e `argsExtras()` — funções, e não valores, porque o server
 * resolve o binário depois de subir e os cookies são conferidos a cada chamada.
 */
export function criarBuscaYoutube({
  binario,
  argsExtras = () => [],
  rodar,
  agora = () => Date.now(),
  quantos = 10,
} = {}) {
  const executar = rodar ?? rodarYtdlpPadrao({ binario, argsExtras });
  /** termo normalizado (minúsculo) → { em, resultados } */
  const cache = new Map();
  /** Mesma busca chegando duas vezes enquanto a primeira roda: um processo só. */
  const emCurso = new Map();
  /** chave do usuário → instantes das buscas que custaram yt-dlp */
  const historico = new Map();
  let rodando = 0;

  function consultarLimite(chave) {
    const t = agora();
    const recentes = (historico.get(chave) ?? []).filter((em) => t - em < JANELA_MS);
    if (recentes.length >= LIMITE_POR_JANELA) {
      historico.set(chave, recentes);
      throw new LimiteDeBusca(Math.max(1, Math.ceil((recentes[0] + JANELA_MS - t) / 1000)));
    }
    recentes.push(t);
    historico.set(chave, recentes);
    // Mapa de quem já buscou não pode crescer para sempre num serviço que
    // fica semanas no ar.
    if (historico.size > 5000) {
      for (const [k, v] of historico) if (!v.some((em) => t - em < JANELA_MS)) historico.delete(k);
    }
  }

  async function buscar(termoCru, chaveUsuario = 'anonimo') {
    const termo = normalizarTermo(termoCru);
    if (!termo) return [];
    const chave = termo.toLowerCase();
    const guardado = cache.get(chave);
    // Cache ANTES do limite: repetir a mesma busca (voltar à tela, outra aba)
    // não custa nada ao YouTube e não deve custar nada a quem busca.
    if (guardado && agora() - guardado.em < CACHE_TTL_MS) return guardado.resultados;
    const pendente = emCurso.get(chave);
    if (pendente) return pendente;

    consultarLimite(chaveUsuario);
    if (rodando >= MAX_SIMULTANEAS) throw new LimiteDeBusca(3);

    rodando += 1;
    const promessa = (async () => {
      try {
        const resultados = parseResultados(await executar(termo, quantos));
        cache.set(chave, { em: agora(), resultados });
        if (cache.size > CACHE_MAX_TERMOS) cache.delete(cache.keys().next().value);
        return resultados;
      } finally {
        rodando -= 1;
        emCurso.delete(chave);
      }
    })();
    emCurso.set(chave, promessa);
    return promessa;
  }

  return { buscar };
}
