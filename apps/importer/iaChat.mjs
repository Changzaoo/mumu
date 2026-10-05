/**
 * Chat de TEXTO do importador: Claude (via CLI logado na conta do dono) com
 * queda para a NVIDIA. É o que atende o `POST /ai/chat`, que o navegador usa
 * para limpar título, classificar gênero, auditar atribuição, identificar a
 * faixa e separar artistas. O contrato com o navegador não mudou: entra
 * `messages`, sai `{ content }`.
 *
 * NÃO cobre (e não finge cobrir): transcrição de áudio (Riva/whisper) e
 * embeddings ("dna") — o Claude não tem equivalente; continuam na NVIDIA/local.
 *
 * ── MAPA ÚNICO TAREFA → MODELO ──────────────────────────────────────────────
 * Aliases que o CLI aceita. `opus` não é padrão de nada.
 *   haiku  — classificação/extração simples e em volume.
 *   sonnet — julgamento e conhecimento de mundo, onde errar escreve metadata
 *            errada (identidade, auditoria de atribuição, artista, descrição).
 * Cada tarefa pode ser trocada por `CLAUDE_MODELO_<TAREFA>` (ex.:
 * `CLAUDE_MODELO_VERIFY=haiku`); tarefa desconhecida usa `CLAUDE_MODELO_PADRAO`.
 *
 * ── PROVEDOR ────────────────────────────────────────────────────────────────
 *   IA_PROVEDOR=claude (padrão) | nvidia
 *   Com `claude`, qualquer falha do CLI (ausente, deslogado, limite, timeout,
 *   saída inválida) cai para a NVIDIA SE `NVIDIA_API_KEY` existir; o log diz
 *   quem atendeu. `IA_FALLBACK_NVIDIA=0` desliga a queda.
 */
import crypto from 'node:crypto';
import { ClaudeCliError } from './claudeCli.mjs';

export const MODELO_POR_TAREFA = Object.freeze({
  cleanTitle: 'haiku',
  genre: 'haiku',
  genreLote: 'haiku',
  verify: 'sonnet',
  verifyGenre: 'sonnet',
  splitArtists: 'sonnet',
  identity: 'sonnet',
  artistGenre: 'sonnet',
  describe: 'sonnet',
});

const MODELO_PADRAO = 'sonnet';
/** O navegador só pode pedir estes aliases; `opus` só por env, nunca pelo corpo da requisição. */
const ALIASES_PEDIVEIS = new Set(['haiku', 'sonnet']);

/**
 * Como reconhecer a tarefa pelo system prompt. O navegador manda o mesmo `model`
 * da NVIDIA para tudo, então a tarefa se lê do prompt (as frases abaixo são as de
 * `packages/shared/src/ai/{curation,agents}.ts` e `apps/web/src/lib/ai/ai.ts`;
 * o teste confere que continuam lá). `body.task` explícito tem prioridade.
 */
const ASSINATURAS = [
  ['Você extrai o artista e o título', 'cleanTitle'],
  ['Você separa os artistas', 'splitArtists'],
  ['Você é um especialista em identificar músicas', 'identity'],
  ['Você confere se a atribuição', 'verify'],
  ['Você confere se a CATEGORIA', 'verifyGenre'],
  ['Você classifica uma música em UM gênero', 'genre'],
  ['Você classifica músicas em gêneros', 'genreLote'],
  ['Você diz qual é o gênero PRINCIPAL', 'artistGenre'],
  ['Você escreve a descrição curta', 'describe'],
];
export const ASSINATURAS_DE_TAREFA = ASSINATURAS;

export function inferirTarefa(messages) {
  const sistema = (messages ?? [])
    .filter((m) => m?.role === 'system' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n');
  for (const [frase, tarefa] of ASSINATURAS) if (sistema.includes(frase)) return tarefa;
  return null;
}

/** Modelo Claude de uma tarefa (env > mapa > padrão). */
export function modeloDaTarefa(tarefa, env = process.env) {
  const chave = tarefa ? `CLAUDE_MODELO_${tarefa.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}` : '';
  const doEnv = chave ? (env[chave] ?? '').trim() : '';
  if (doEnv) return doEnv;
  if (tarefa && MODELO_POR_TAREFA[tarefa]) return MODELO_POR_TAREFA[tarefa];
  return (env.CLAUDE_MODELO_PADRAO ?? '').trim() || MODELO_PADRAO;
}

/** system → `sistema`; o resto vira o prompt (um turno só: o CLI roda 1 volta, sem ferramentas). */
export function messagesParaPrompt(messages) {
  const sistema = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const resto = messages.filter((m) => m.role !== 'system');
  const prompt =
    resto.length === 1
      ? resto[0].content
      : resto.map((m) => `${m.role === 'assistant' ? 'Assistente' : 'Usuário'}:\n${m.content}`).join('\n\n');
  return { sistema, prompt };
}

/**
 * @param {{
 *   claude: { perguntar: Function },
 *   nvidia?: ((args: {messages: any[], model?: string, maxTokens?: number, temperature?: number}) => Promise<string|null>) | null,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (...a: unknown[]) => void,
 * }} deps
 */
export function criarIaChat({ claude, nvidia = null, env = process.env, log = () => {} }) {
  const provedorConfigurado = (env.IA_PROVEDOR ?? 'claude').trim().toLowerCase();
  const usarClaude = provedorConfigurado !== 'nvidia';
  const quedaPermitida = (env.IA_FALLBACK_NVIDIA ?? '1') !== '0';
  const tamanhoCache = 500;
  const validadeCacheMs = 24 * 60 * 60_000;
  /** Resultado do Claude por (modelo + conversa): título repetido não gasta cota de novo. */
  const cache = new Map();

  function chaveDe(modelo, messages) {
    return crypto.createHash('sha1').update(modelo).update('\0').update(JSON.stringify(messages)).digest('hex');
  }

  /** Há algum provedor que possa atender? (para o 503 do endpoint) */
  function configurado() {
    return (usarClaude && claude.disponivel?.() !== false) || Boolean(nvidia);
  }

  /**
   * @returns {Promise<{content: string, provedor: 'claude'|'nvidia', modelo: string, tarefa: string|null}>}
   * Lança se NENHUM provedor respondeu.
   */
  async function conversar({ messages, tarefa, model, maxTokens, temperature }) {
    const t = tarefa && typeof tarefa === 'string' ? tarefa : inferirTarefa(messages);
    const pedido = typeof model === 'string' ? model.trim() : '';
    const modelo = ALIASES_PEDIVEIS.has(pedido) ? pedido : modeloDaTarefa(t, env);

    let falhaClaude = null;
    if (usarClaude) {
      const chave = chaveDe(modelo, messages);
      const guardado = cache.get(chave);
      if (guardado && guardado.ate > Date.now()) {
        return { content: guardado.content, provedor: 'claude', modelo, tarefa: t };
      }
      try {
        const { sistema, prompt } = messagesParaPrompt(messages);
        const r = await claude.perguntar({ sistema, prompt, modelo });
        log(`ia: ${t ?? 'tarefa?'} → claude/${modelo} em ${r.duracaoMs ?? '?'}ms`);
        if (cache.size >= tamanhoCache) cache.delete(cache.keys().next().value);
        cache.set(chave, { content: r.texto, ate: Date.now() + validadeCacheMs });
        return { content: r.texto, provedor: 'claude', modelo, tarefa: t };
      } catch (err) {
        falhaClaude = err;
        const cod = err instanceof ClaudeCliError ? err.codigo : 'erro';
        if (!(nvidia && quedaPermitida)) {
          log(`ia: ${t ?? 'tarefa?'} claude falhou (${cod}) e não há queda para a NVIDIA`);
          throw err;
        }
        log(`ia: ${t ?? 'tarefa?'} claude falhou (${cod}) → caindo para a NVIDIA`);
      }
    }

    if (!nvidia) throw falhaClaude ?? new Error('Nenhum provedor de IA configurado.');
    const nvModelo = pedido && !ALIASES_PEDIVEIS.has(pedido) ? pedido : undefined;
    const content = await nvidia({ messages, model: nvModelo, maxTokens, temperature });
    if (!content) throw new Error('NVIDIA respondeu vazio.');
    log(`ia: ${t ?? 'tarefa?'} → nvidia/${nvModelo ?? 'padrão'}${falhaClaude ? ' (queda)' : ''}`);
    return { content, provedor: 'nvidia', modelo: nvModelo ?? 'padrão', tarefa: t };
  }

  return { conversar, configurado, tamanhoDoCache: () => cache.size };
}
