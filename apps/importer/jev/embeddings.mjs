/**
 * EMBEDDINGS LOCAIS — texto vira vetor nesta CPU, sem chave e sem rede depois
 * do primeiro download do modelo.
 *
 * Modelo: `Xenova/multilingual-e5-small` (ONNX, int8), 384 dimensões, entende
 * pt-BR e inglês no mesmo espaço. Escolhido por caber num i5 de 2014: pesa
 * ~120 MB em disco e vetoriza dezenas de textos curtos por segundo (medido em
 * calibrar.mjs). O e5 pede o prefixo "query: " nos textos; sem ele a
 * semelhança fica achatada.
 *
 * Carrega uma vez (lazy) e serializa as chamadas: a ONNX já usa os núcleos
 * todos num lote; dois lotes ao mesmo tempo só disputam CPU com o /stream.
 */
import os from 'node:os';

const MODELO = process.env.JEV_MODELO || 'Xenova/multilingual-e5-small';
const DIR_MODELOS = process.env.JEV_MODELOS_DIR || 'D:/Aurial/jev/modelos';
const LOTE = 32;
/** Textos longos (letra inteira) são cortados: o e5-small lê 512 tokens. */
const MAX_CHARS = 1500;

let pipelinePromise = null;
let fila = Promise.resolve();

/** Cache pequeno por texto: a mesma pergunta repete os mesmos critérios. */
const cache = new Map();
const CACHE_MAX = 4000;

async function carregar() {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = DIR_MODELOS;
    const extrator = await pipeline('feature-extraction', MODELO, { dtype: 'q8' });
    return extrator;
  })().catch((e) => {
    pipelinePromise = null; // permite nova tentativa (sem rede no primeiro download)
    throw e;
  });
  return pipelinePromise;
}

function preparar(texto) {
  const t = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
  return t.startsWith('query: ') || t.startsWith('passage: ') ? t : `query: ${t}`;
}

/** textos[] → vetores[] (normalizados, 384 dims), na mesma ordem. */
export async function embed(textos) {
  const preparados = textos.map(preparar);
  const saida = new Array(preparados.length);
  const faltam = [];
  preparados.forEach((t, i) => {
    const c = cache.get(t);
    if (c) saida[i] = c;
    else faltam.push(i);
  });
  if (faltam.length === 0) return saida;
  const extrator = await carregar();
  const trabalho = fila.then(async () => {
    for (let i = 0; i < faltam.length; i += LOTE) {
      const indices = faltam.slice(i, i + LOTE);
      const out = await extrator(
        indices.map((k) => preparados[k]),
        { pooling: 'mean', normalize: true },
      );
      const lista = out.tolist();
      indices.forEach((k, j) => {
        saida[k] = lista[j];
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(preparados[k], lista[j]);
      });
    }
  });
  fila = trabalho.catch(() => undefined);
  await trabalho;
  return saida;
}

/** O modelo já está carregado (não dispara o download)? */
export function pronto() {
  return pipelinePromise !== null;
}

/** Aquece o modelo em segundo plano, com prioridade baixa de CPU. */
export function aquecer(log = () => {}) {
  const inicio = Date.now();
  void carregar()
    .then(() =>
      log(`jev: embeddings prontos (${MODELO}) em ${Math.round((Date.now() - inicio) / 1000)}s`),
    )
    .catch((e) => log('jev: embeddings indisponíveis:', e instanceof Error ? e.message : e));
  try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_NORMAL);
  } catch {
    /* sem permissão */
  }
}
