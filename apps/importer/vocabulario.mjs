/**
 * MEMÓRIA DE CORREÇÃO POR ARTISTA — o que a transcrição livre erra de jeito
 * SISTEMÁTICO (sotaque, autotune, gíria) e a letra publicada corrige.
 *
 * Cada vez que uma transcrição é CONFIRMADA contra a letra de verdade (ver
 * confirmarPelaVoz.ts/calibragem.ts no cliente), o app manda para cá os
 * pares ouvido→real que encontrou (ex.: "a ful"→"afu", "pela sol"→"pela
 * Sul"). A MESMA gíria erra do MESMO jeito em várias músicas do mesmo
 * artista — o que se aprende numa faixa ajuda a próxima.
 *
 * Usado como `initial_prompt` do whisper na próxima TRANSCRIÇÃO (livre, sem
 * letra publicada) daquele artista: primar o decodificador com o vocabulário
 * certo é mais barato e mais robusto do que tentar corrigir o texto depois —
 * e não mexe no ALINHAMENTO (que já recebe o texto certo e só acha o tempo).
 *
 * Uma correção só entra na dica quando já apareceu pelo menos duas vezes
 * (`CONTAGEM_MINIMA`) — uma transcrição ruim isolada é ruído do ASR naquele
 * trecho, não um padrão do artista.
 */
import { readFile, writeFile } from 'node:fs/promises';

/** Abaixo disto, a correção fica guardada mas não vira dica — ver o
 *  comentário no topo do arquivo. */
const CONTAGEM_MINIMA = 2;
/** `initial_prompt` do whisper é só um empurrão de contexto: grande demais
 *  vira ruído e custa tempo de decodificação à toa. */
const TETO_PROMPT_CHARS = 200;
/** Quantas correções guardar por artista — o objetivo é o vocabulário
 *  RECORRENTE, não um dicionário enciclopédico crescendo sem fim. */
const MAX_CORRECOES_POR_ARTISTA = 200;
/** `/letra/aprendizado` é rota pública (sem login): sem teto de artistas, um
 *  script mandando um nome inventado por pedido faz o JSON — que é lido
 *  inteiro na memória e regravado a cada lote — crescer sem fim. O teto por
 *  artista não protege disso; estes dois protegem. */
export const MAX_ARTISTAS = 5000;
const MAX_CHARS_ARTISTA = 120;

/** Espelha a normalização de artista já usada em outrasFontesDeLetra.mjs —
 *  duplicada de propósito (módulos independentes, função pequena). */
export function normalizarArtista(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Insere/atualiza UMA correção na entrada de um artista — pura, testável sem
 * tocar disco. `entrada` é `{ [ouvidoNormalizado]: { real, contagem } }`
 * (ou `undefined`/`{}` para um artista novo).
 */
export function mesclarCorrecao(entrada, ouvido, real) {
  const atual = entrada ?? {};
  const existente = atual[ouvido];
  const contagem = (existente?.contagem ?? 0) + 1;
  let base = atual;
  // Teto: um artista novo demais não empurra o dicionário para sempre — corta
  // a MENOS vista antes de crescer mais.
  if (!existente) {
    const chaves = Object.keys(atual);
    if (chaves.length >= MAX_CORRECOES_POR_ARTISTA) {
      const piorChave = chaves.reduce((pior, k) =>
        (atual[k]?.contagem ?? 0) < (atual[pior]?.contagem ?? 0) ? k : pior,
      );
      base = { ...atual };
      delete base[piorChave];
    }
  }
  return { ...base, [ouvido]: { real, contagem } };
}

/**
 * As formas REAIS das correções vistas ≥ `CONTAGEM_MINIMA` vezes, como um
 * texto curto de contexto — as mais vistas primeiro, cortado no teto de
 * tamanho. Pura.
 */
export function construirPrompt(entrada) {
  if (!entrada) return '';
  const formas = Object.values(entrada)
    .filter((v) => (v?.contagem ?? 0) >= CONTAGEM_MINIMA)
    .sort((a, b) => b.contagem - a.contagem)
    .map((v) => v.real);
  let prompt = '';
  for (const forma of formas) {
    if (!forma) continue;
    const proximo = prompt ? `${prompt}, ${forma}` : forma;
    if (proximo.length > TETO_PROMPT_CHARS) break;
    prompt = proximo;
  }
  return prompt;
}

/**
 * @param {{ arquivo: string, log?: (...a: unknown[]) => void }} opcoes
 */
export function criarVocabulario({ arquivo, log }) {
  /** @type {Record<string, Record<string, {real: string, contagem: number}>>} */
  let dados = null;
  let carregando = null;
  let gravacaoAgendada = null;

  async function carregar() {
    if (dados) return dados;
    if (!carregando) {
      carregando = readFile(arquivo, 'utf8')
        .then((raw) => JSON.parse(raw))
        .catch(() => ({}));
    }
    dados = await carregando;
    return dados;
  }

  function agendarGravacao() {
    if (gravacaoAgendada) return;
    gravacaoAgendada = setTimeout(() => {
      gravacaoAgendada = null;
      if (!dados) return;
      // Melhor esforço: sem disco, só perde o aprendizado desta rodada — não
      // é motivo para derrubar quem já foi respondido.
      writeFile(arquivo, JSON.stringify(dados)).catch((e) =>
        log?.('vocabulario: falha ao gravar', e?.message ?? e),
      );
    }, 2000);
    gravacaoAgendada.unref?.();
  }

  /** Mescla um lote de correções ouvidas para um artista. Nunca lança. */
  async function registrar(artista, correcoes) {
    try {
      const chaveArtista = normalizarArtista(artista);
      if (!chaveArtista || !Array.isArray(correcoes) || correcoes.length === 0) return;
      if (chaveArtista.length > MAX_CHARS_ARTISTA) return;
      const base = await carregar();
      let entrada = base[chaveArtista];
      // Artista NOVO com o dicionário cheio fica de fora: quem já está lá é o
      // vocabulário que realmente se repete, e não vale expulsá-lo por um nome
      // que pode ser lixo.
      if (!entrada && Object.keys(base).length >= MAX_ARTISTAS) return;
      let mudou = false;
      for (const par of correcoes.slice(0, 50)) {
        const ouvido = String(par?.ouvido ?? '')
          .trim()
          .toLowerCase()
          .slice(0, 80);
        const real = String(par?.real ?? '').trim().slice(0, 80);
        if (!ouvido || !real || ouvido === real.toLowerCase()) continue;
        entrada = mesclarCorrecao(entrada, ouvido, real);
        mudou = true;
      }
      if (mudou) {
        base[chaveArtista] = entrada;
        dados = base;
        agendarGravacao();
      }
    } catch (e) {
      log?.('vocabulario: registrar falhou', e?.message ?? e);
    }
  }

  /** Dica para o whisper deste artista — string vazia quando não há nada
   *  (ainda sem correções, ou nenhuma repetida o bastante). Nunca lança. */
  async function promptPara(artista) {
    try {
      const chaveArtista = normalizarArtista(artista);
      if (!chaveArtista) return '';
      const base = await carregar();
      return construirPrompt(base[chaveArtista]);
    } catch {
      return '';
    }
  }

  return { registrar, promptPara };
}
