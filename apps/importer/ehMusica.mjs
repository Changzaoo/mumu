/**
 * ISSO É MÚSICA? — para importar um CANAL (ou uma playlist grande) sem trazer
 * junto vlog, entrevista, bastidores, trailer, short e documentário.
 *
 * Medido no canal da 30PRAUM (200 vídeos): quase tudo é faixa, mas no meio
 * estão "ISSO É TRAP." (documentário de 14 min), dois "(Making of)", um esquete
 * ("GLOBAL NEWSPAPER: THE COLLAPSE IS REAL!"), um trecho de 44 s e a mesma
 * música duas vezes (clipe e áudio: "Matuê - 333" com 340 s e 322 s).
 *
 * A lista plana do canal já traz título e duração — nada de abrir vídeo por
 * vídeo. Três camadas:
 *   1. CERTEZAS PELA FORMA (`classificar`): marcas de música vs. marcas de
 *      não-música e duração;
 *   2. DÚVIDA vai à prova (`confirmarNoCatalogo`, quem chama decide): existe
 *      uma música com esse nome e duração parecida no catálogo da Apple?
 *   3. REPETIDAS (`semRepetidas`): a mesma música entra uma vez só — a versão
 *      de áudio (sem a introdução do clipe) quando há.
 */

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Duração de uma faixa (s): abaixo é trecho/short, acima é show/mix/doc. */
export const DURACAO_MIN_S = 60;
export const DURACAO_MAX_S = 10 * 60;

const NAO_E_MUSICA =
  /\b(?:making[\s-]?of|bastidores?|behind the scenes|bts|entrevista|interview|podcast|react(?:ion|ing)?|rea[cç](?:ao|ão|indo)|reagindo|vlog|document[aá]rio|documentary|trailer|teaser|pr[eé]via|preview|snippet|tutorial|unboxing|q ?& ?a|resenha|desafio|challenge|an[uú]ncio|announcement|live stream|ao vivo agora|epis[oó]dio|epis[oó]de|parte \d+ do|cortes?|melhores momentos|highlights|shorts)\b|#shorts/i;

const MARCA_DE_MUSICA =
  /\b(?:clipe|videoclipe|video ?clip|official (?:music )?video|v[ií]deo oficial|[aá]udio oficial|official audio|audio|[aá]udio|visuali[sz]er|lyric(?:s)? video|lyrics?|letra|feat\.?|ft\.?|prod\.?|remix|bonus track|visual story|ep\b|single)\b/i;

/** "ARTISTA - MÚSICA" (o separador de quase todo lançamento). */
const SEPARADOR = /\s[-–—|]\s/;

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase();
}

/**
 * Classifica uma entrada da lista plana: 'musica', 'nao' ou 'duvida', com o
 * motivo (vai para a tela: "5 vídeos não eram música — bastidores, trailer…").
 */
export function classificar({ titulo, duracaoSeg }) {
  const t = String(titulo ?? '').trim();
  const d = Number(duracaoSeg) || 0;
  if (!t) return { veredito: 'nao', motivo: 'sem título' };
  if (NAO_E_MUSICA.test(t)) return { veredito: 'nao', motivo: 'não é música (pelo título)' };
  if (d > 0 && d < DURACAO_MIN_S) return { veredito: 'nao', motivo: 'curto demais (trecho/short)' };
  const temMarca = MARCA_DE_MUSICA.test(t);
  const temSeparador = SEPARADOR.test(t);
  if (d > DURACAO_MAX_S) {
    // Faixa longa existe ("MIRACLE + FORMULAS & MIRAGES", 6:52), mas acima
    // de 10 min sem marca nenhuma é show, mix ou documentário.
    return temMarca && d <= 15 * 60
      ? { veredito: 'duvida', motivo: 'longo demais para ter certeza' }
      : { veredito: 'nao', motivo: 'longo demais (show/mix/documentário)' };
  }
  if (temSeparador || temMarca) return { veredito: 'musica', motivo: 'formato de faixa' };
  return { veredito: 'duvida', motivo: 'título sem formato de faixa' };
}

/** "Matuê - 333 (Clipe Oficial)" e "Matuê - 333" são a mesma música. */
export function chaveDaMusica(titulo) {
  return norm(titulo)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(
      /\b(?:clipe|videoclipe|video|oficial|official|audio|visualizer|lyrics?|letra|hd|4k)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nota da versão: áudio/visualizer > sem marca > clipe; curta ganha empate. */
function notaDaVersao({ titulo, duracaoSeg }) {
  const t = norm(titulo);
  let n = 0;
  if (/\b(?:audio|visualizer|lyric)/.test(t)) n += 2;
  if (/\b(?:clipe|video|making|visual story)/.test(t)) n -= 1;
  return n - (Number(duracaoSeg) || 0) / 10_000;
}

/**
 * A mesma música uma vez só. Mantém a ordem da primeira aparição e troca pela
 * versão de nota maior (a de áudio, sem a introdução do clipe).
 */
export function semRepetidas(entradas) {
  const porChave = new Map();
  const ordem = [];
  const repetidas = [];
  for (const e of entradas) {
    const chave = chaveDaMusica(e.titulo);
    if (!chave) continue;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, e);
      ordem.push(chave);
      continue;
    }
    if (notaDaVersao(e) > notaDaVersao(atual)) {
      repetidas.push(atual);
      porChave.set(chave, e);
    } else {
      repetidas.push(e);
    }
  }
  return { unicas: ordem.map((k) => porChave.get(k)), repetidas };
}

/**
 * A DÚVIDA VAI À PROVA: existe uma música com este título (e duração parecida)
 * no catálogo da Apple? `buscar(termo)` devolve a resposta da busca do iTunes
 * (injetável: testes sem rede; quem chama cuida de cache e de limite).
 */
export async function confirmarNoCatalogo({ titulo, duracaoSeg, artista }, buscar) {
  const nome = chaveDaMusica(String(titulo).split(SEPARADOR).pop() ?? titulo);
  if (!nome) return false;
  const termo = [artista, nome].filter(Boolean).join(' ');
  const resposta = await buscar(termo).catch(() => null);
  const resultados = Array.isArray(resposta?.results) ? resposta.results : [];
  const d = Number(duracaoSeg) || 0;
  return resultados.some((r) => {
    if (r.wrapperType !== 'track' || r.kind !== 'song') return false;
    const nomeDaFaixa = chaveDaMusica(r.trackName ?? '');
    if (!nomeDaFaixa || !(nomeDaFaixa.includes(nome) || nome.includes(nomeDaFaixa))) return false;
    const dur = (Number(r.trackTimeMillis) || 0) / 1000;
    return !d || !dur || Math.abs(dur - d) <= Math.max(10, d * 0.12);
  });
}

/**
 * Filtra uma lista de entradas de canal/playlist. `buscar` opcional: sem ele,
 * a dúvida fica de fora (melhor faltar uma faixa do que entrar um vlog).
 * Devolve as músicas e o que ficou de fora, com o motivo.
 */
export async function soMusicas(entradas, { buscar, artista, maxConsultas = 40 } = {}) {
  const musicas = [];
  const fora = [];
  let consultas = 0;
  for (const e of entradas) {
    const c = classificar(e);
    if (c.veredito === 'musica') musicas.push(e);
    else if (c.veredito === 'nao') fora.push({ ...e, motivo: c.motivo });
    else if (buscar && consultas < maxConsultas) {
      consultas++;
      if (await confirmarNoCatalogo({ ...e, artista }, buscar)) musicas.push(e);
      else fora.push({ ...e, motivo: 'não achei essa música no catálogo' });
    } else {
      fora.push({ ...e, motivo: c.motivo });
    }
  }
  const { unicas, repetidas } = semRepetidas(musicas);
  for (const r of repetidas) fora.push({ ...r, motivo: 'versão repetida' });
  return { musicas: unicas, fora };
}
