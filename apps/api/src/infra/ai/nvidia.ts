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
import type { AiMessage } from '@aurial/shared';

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

  if (response.status === 429 || response.status >= 500) {
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
