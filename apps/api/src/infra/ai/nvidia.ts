/**
 * Cliente NVIDIA NIM para os agentes de curadoria do servidor.
 *
 * Diferente do proxy do importador (que existe só para manter a chave fora do
 * navegador), aqui o worker fala direto com a NVIDIA. A chave nunca sai do
 * servidor de qualquer jeito.
 *
 * Concorrência: as chamadas são ligadas em REDE, não em CPU — ficam esperando
 * a NVIDIA responder. Por isso vale rodar várias em paralelo mesmo numa máquina
 * de 2 núcleos; o limite real é a cota da NVIDIA, não o processador. O pool
 * abaixo é o que permite os agentes trabalharem simultaneamente sem virar uma
 * rajada que toma 429.
 */
import { env } from '../../config/index.js';
import { logger } from '../../core/logger.js';
import { EMBED_MODEL, type AiMessage } from '@aurial/shared';

const log = logger.child({ infra: 'nvidia' });

const BASE = (env.NVIDIA_BASE || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');

/** Erro que vale re-tentar (limite de cota, indisponibilidade momentânea). */
class RetryableError extends Error {}

export function isNvidiaConfigured(): boolean {
  return Boolean(env.NVIDIA_API_KEY);
}

// ── Pool de concorrência ────────────────────────────────────────────────────

let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < env.NVIDIA_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Uma chamada de chat. Devolve o texto, ou `null` quando a IA falhou —
 * curadoria é best-effort: sem resposta, a faixa fica como está.
 */
/**
 * Quantas vezes a NVIDIA respondeu 429 desde a última leitura.
 *
 * O 429 é a cota dizendo "devagar". Ele já era tratado como falha temporária e
 * repetido, mas ninguém contava — então o único jeito de descobrir que o ritmo
 * estava alto demais era ler o log à mão. Com o contador exposto, quem consome
 * (a curadoria) mede a própria pressão e diminui o lote sozinho, em vez de
 * depender de alguém perceber.
 */
let recusasPorCota = 0;

/**
 * Quantas chamadas a NVIDIA RESPONDEU no mesmo período.
 *
 * O denominador que faltava. Sem ele, "zero recusas" é ambíguo: pode ser a cota
 * folgada — ou pode ser que nenhuma chamada tenha sido feita. A curadoria lia
 * essa ambiguidade como folga e AUMENTAVA o lote a cada volta silenciosa. Numa
 * biblioteca já convergida (que é o estado normal depois de alguns dias) quase
 * toda volta é silenciosa, então o lote subia sozinho de volta ao teto que
 * estourou a cota — e a próxima leva de importações levava a rajada inteira.
 */
let chamadasRespondidas = 0;

export interface PressaoDeCota {
  /** Respostas 429 no período. */
  recusas: number;
  /** Chamadas que a API respondeu no período — o denominador. */
  chamadas: number;
}

/** Lê e zera os contadores — quem chama fica responsável pelo período medido. */
export function pressaoDeCotaDesdeAUltimaLeitura(): PressaoDeCota {
  const medida = { recusas: recusasPorCota, chamadas: chamadasRespondidas };
  recusasPorCota = 0;
  chamadasRespondidas = 0;
  return medida;
}

export async function nvidiaChat(
  messages: AiMessage[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string | null> {
  if (!isNvidiaConfigured()) return null;

  await acquire();
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await once(messages, opts);
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt === 3) {
          log.warn({ err, attempt }, 'chamada à NVIDIA falhou');
          return null;
        }
        // Espera crescente: 2s, 4s. Cota costuma liberar sozinha.
        await sleep(2000 * attempt);
      }
    }
    return null;
  } finally {
    release();
  }
}

async function once(
  messages: AiMessage[],
  opts: { model?: string; maxTokens?: number },
): Promise<string | null> {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? env.NVIDIA_MODEL,
      messages,
      // O Nemotron raciocina antes de responder e esse gasto sai do mesmo
      // teto — orçamento apertado devolve o raciocínio truncado, não a resposta.
      max_tokens: Math.min(opts.maxTokens ?? 2048, 4096),
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(env.NVIDIA_TIMEOUT_MS),
  });

  // Contada assim que a API RESPONDE, qualquer que seja o status: é o
  // denominador da pressão de cota. Erro de rede e timeout não chegam aqui e
  // não contam — nesses casos a NVIDIA não disse nada sobre o próprio ritmo.
  chamadasRespondidas += 1;

  if (response.status === 429 || response.status >= 500) {
    if (response.status === 429) recusasPorCota += 1;
    throw new RetryableError(`NVIDIA respondeu ${response.status}`);
  }
  if (!response.ok) {
    log.warn({ status: response.status }, 'NVIDIA recusou a requisição');
    return null;
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;

  // `length` significa que o teto acabou antes da resposta: o que veio é
  // raciocínio pela metade, não conclusão. Tratar como falha é mais honesto
  // que gravar lixo na biblioteca do usuário.
  if (choice?.finish_reason === 'length') {
    log.warn('resposta truncada pelo teto de tokens — descartada');
    return null;
  }

  return typeof content === 'string' && content.trim() ? content : null;
}

// ── Embeddings ──────────────────────────────────────────────────────────────

/**
 * Vetoriza textos em lote. Devolve `null` na falha — quem chama trata a
 * ausência de DNA como "essa faixa ainda não entrou na busca semântica", não
 * como erro fatal.
 *
 * `input_type` NÃO é enfeite: os modelos de recuperação são treinados com
 * prefixos diferentes para o que está no acervo (`passage`) e para o que o
 * usuário digitou (`query`). Vetorizar a busca como se fosse acervo piora o
 * casamento sem dar erro nenhum.
 */
export async function nvidiaEmbed(
  inputs: string[],
  opts: { inputType?: 'passage' | 'query'; model?: string } = {},
): Promise<number[][] | null> {
  if (!isNvidiaConfigured() || inputs.length === 0) return null;

  await acquire();
  try {
    const response = await fetch(`${BASE}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model ?? EMBED_MODEL,
        input: inputs,
        input_type: opts.inputType ?? 'passage',
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(env.NVIDIA_TIMEOUT_MS),
    });

    chamadasRespondidas += 1;

    if (!response.ok) {
      // O 429 DAQUI ERA INVISÍVEL, e essa era a metade cega do termostato.
      //
      // Só o chat contava recusa. A vetorização (`gravarDna`) dimensiona o
      // próprio lote pelo mesmo `loteEmVigor()` e bate na MESMA cota, então uma
      // volta podia tomar recusa atrás de recusa no endpoint de embedding e
      // reportar "zero recusas" — o que a curadoria lia como folga, e aí ela
      // AUMENTAVA o lote. O termostato acelerava justamente quando estava
      // sufocando.
      if (response.status === 429) recusasPorCota += 1;
      log.warn({ status: response.status }, 'NVIDIA recusou o embedding');
      return null;
    }

    const data = (await response.json()) as {
      data?: { embedding?: unknown; index?: unknown }[];
    };
    const rows = data.data;
    if (!Array.isArray(rows) || rows.length !== inputs.length) {
      log.warn({ pedidos: inputs.length, recebidos: rows?.length }, 'embedding veio incompleto');
      return null;
    }

    // A API devolve `index` — respeitar a ordem dela em vez da ordem do array,
    // senão o vetor de uma faixa acaba gravado em outra.
    const ordered: number[][] = new Array(inputs.length);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const at = typeof row.index === 'number' ? row.index : i;
      if (!Array.isArray(row.embedding) || at < 0 || at >= inputs.length) return null;
      ordered[at] = row.embedding as number[];
    }
    return ordered.every(Array.isArray) ? ordered : null;
  } catch (err) {
    log.warn({ err }, 'chamada de embedding falhou');
    return null;
  } finally {
    release();
  }
}
