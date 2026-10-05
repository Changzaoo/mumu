/**
 * Cliente do Claude Code CLI em modo não interativo — usa a conta Claude do dono
 * (login do `claude`) em vez de uma chave de API.
 *
 * Cada pergunta sobe UM processo `claude -p` (spawn SEM shell, prompt por stdin,
 * sem ferramentas, sem sessão gravada). Como cada processo é um Node inteiro,
 * há fila com poucos em paralelo (`CLAUDE_CLI_CONCURRENCY`, padrão 2).
 *
 * Erros são tipados (`ClaudeCliError.codigo`) para quem chama decidir se cai
 * para outro provedor:
 *   ausente         — não achei o executável do CLI
 *   nao_logado      — o CLI não está autenticado nesta máquina
 *   limite          — limite de uso/cota da conta atingido (pausa a fila)
 *   indisponivel    — Claude sobrecarregado/sem rede (pausa curta)
 *   timeout         — passou de `timeoutMs`
 *   saida_invalida  — saída do CLI (ou o JSON pedido) não pôde ser lido
 *   fila_cheia      — fila de espera estourou o teto
 *   falhou          — qualquer outra falha do processo
 *
 * Variáveis de ambiente (todas opcionais):
 *   CLAUDE_CLI_PATH          caminho do executável (padrão: acha sozinho — ver
 *                            `resolverExecutavelClaude`)
 *   CLAUDE_CLI_CONCURRENCY   processos simultâneos (1–4, padrão 2)
 *   CLAUDE_CLI_TIMEOUT_MS    teto por chamada (padrão 90000)
 *   CLAUDE_CLI_PAUSA_LIMITE_MS  quanto tempo evitar o CLI após `limite` (padrão 900000)
 */
import { spawn as spawnReal } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class ClaudeCliError extends Error {
  /** @param {string} codigo @param {string} mensagem */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ClaudeCliError';
    this.codigo = codigo;
  }
}

const MODELO_VALIDO = /^[A-Za-z0-9._\-[\]]+$/;
const LIMITE_STDOUT = 4 * 1024 * 1024;
/** Acima disto o system prompt vai pelo stdin, não pela linha de comando. */
const SISTEMA_MAX_ARGV = 6000;

// ── Localizar o executável ──────────────────────────────────────────────────

/**
 * Onde está o `claude`? Ordem: `CLAUDE_CLI_PATH` → PATH → instalação nativa
 * (`~/.local/bin`) → build embutido no app Claude Desktop (Windows:
 * `%APPDATA%\Claude\claude-code\<versão>\<hash>\claude.exe`, o mais novo).
 * Devolve `null` quando não acha. `deps` existe para teste.
 */
export function resolverExecutavelClaude(env = process.env, deps = {}) {
  const existe = deps.existe ?? existsSync;
  const listar = deps.listar ?? ((d) => readdirSync(d));
  const win = (deps.plataforma ?? process.platform) === 'win32';

  const explicito = (env.CLAUDE_CLI_PATH ?? '').trim();
  if (explicito && explicito !== 'claude') return existe(explicito) ? explicito : null;

  const exts = win ? ['.exe', '.cmd'] : [''];
  const sep = win ? ';' : ':';
  for (const dir of (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, `claude${ext}`);
      if (existe(p)) return p;
    }
  }

  const casa = env.USERPROFILE || env.HOME || '';
  if (casa) {
    const nativo = path.join(casa, '.local', 'bin', win ? 'claude.exe' : 'claude');
    if (existe(nativo)) return nativo;
  }

  if (win && env.APPDATA) {
    const base = path.join(env.APPDATA, 'Claude', 'claude-code');
    try {
      const versoes = listar(base).sort(compararVersao).reverse();
      for (const v of versoes) {
        for (const h of listar(path.join(base, v))) {
          const p = path.join(base, v, h, 'claude.exe');
          if (existe(p)) return p;
        }
      }
    } catch {
      /* pasta inexistente */
    }
  }
  return null;
}

function compararVersao(a, b) {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Classificação de falhas ─────────────────────────────────────────────────

/** Lê o texto de erro (resultado do CLI + stderr) e diz que tipo de falha é. */
export function classificarFalha(texto) {
  const t = String(texto ?? '').toLowerCase();
  if (
    /not logged in|please run \/login|run claude login|invalid api key|authentication[_ ]?(error|failed)|oauth token (has )?(expired|revoked)|failed to authenticate|\b401\b/.test(
      t,
    )
  ) {
    return 'nao_logado';
  }
  if (
    /usage limit|limit reached|rate[_ ]?limit|too many requests|\b429\b|quota|credit balance|hit your limit|out of extra usage/.test(
      t,
    )
  ) {
    return 'limite';
  }
  if (/overloaded|\b529\b|\b50[0-4]\b|econnreset|enotfound|etimedout|network|unable to connect/.test(t)) {
    return 'indisponivel';
  }
  return 'falhou';
}

/** Extrai o primeiro objeto/array JSON balanceado de um texto (cerca de markdown ok). */
export function extrairJson(texto) {
  const limpo = String(texto)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(limpo);
  } catch {
    /* varre abaixo */
  }
  for (const [abre, fecha] of [
    ['{', '}'],
    ['[', ']'],
  ]) {
    const ini = limpo.indexOf(abre);
    if (ini === -1) continue;
    let prof = 0;
    let str = false;
    let esc = false;
    for (let i = ini; i < limpo.length; i += 1) {
      const c = limpo[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') str = !str;
      if (str) continue;
      if (c === abre) prof += 1;
      else if (c === fecha) {
        prof -= 1;
        if (prof === 0) {
          try {
            return JSON.parse(limpo.slice(ini, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new ClaudeCliError('saida_invalida', 'A resposta do Claude não é JSON.');
}

/** O `--output-format json` devolve um objeto `result`; versões podem devolver um array de eventos. */
function lerEnvelope(stdout) {
  let bruto;
  try {
    bruto = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (Array.isArray(bruto)) {
    return [...bruto].reverse().find((e) => e && e.type === 'result') ?? null;
  }
  return bruto && typeof bruto === 'object' ? bruto : null;
}

// ── Montagem do comando ─────────────────────────────────────────────────────

function ehScriptWindows(exe) {
  return /\.(cmd|bat)$/i.test(exe);
}

/**
 * Argumentos do `claude -p`. Sem ferramentas e sem sessão; `--safe-mode` tira
 * CLAUDE.md, hooks, plugins e MCP do caminho (mais rápido e previsível) mantendo
 * o login. O prompt NÃO vai aqui — vai por stdin.
 */
export function montarArgs({ modelo, sistema }) {
  const args = [
    '-p',
    '--model',
    modelo,
    '--output-format',
    'json',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--safe-mode',
  ];
  if (sistema) args.push('--system-prompt', sistema);
  // Por último: `--tools` aceita lista e "" desliga todas.
  args.push('--tools', '');
  return args;
}

/** Variáveis repassadas ao CLI: sem os segredos do importador e sem o rastro de uma sessão Claude Code pai. */
function ambienteDoFilho(env) {
  const out = { ...env };
  delete out.NVIDIA_API_KEY;
  delete out.IMPORT_SERVICE_TOKEN;
  delete out.CLAUDECODE;
  for (const k of Object.keys(out)) {
    if (/^CLAUDE_CODE_(?!OAUTH_TOKEN)/.test(k)) delete out[k];
  }
  return out;
}

// ── O cliente ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   spawn?: typeof spawnReal,
 *   resolver?: () => string | null,
 *   agora?: () => number,
 *   log?: (...a: unknown[]) => void,
 * }} [opts]
 */
export function criarClaudeCli(opts = {}) {
  const env = opts.env ?? process.env;
  const spawn = opts.spawn ?? spawnReal;
  const resolver = opts.resolver ?? (() => resolverExecutavelClaude(env));
  const agora = opts.agora ?? Date.now;
  const log = opts.log ?? (() => {});

  const concorrencia = Math.min(4, Math.max(1, Number(env.CLAUDE_CLI_CONCURRENCY) || 2));
  const timeoutPadrao = Number(env.CLAUDE_CLI_TIMEOUT_MS) || 90_000;
  const pausaLimiteMs = Number(env.CLAUDE_CLI_PAUSA_LIMITE_MS) || 15 * 60_000;
  const filaMax = 100;

  let ativos = 0;
  const fila = [];
  /** Depois de `limite`/`nao_logado`/`indisponivel`, não insiste até esse instante. */
  let pausa = { ate: 0, codigo: '', mensagem: '' };
  let exeCache = null;
  let exeCacheEm = 0;

  const stats = { chamadas: 0, ok: 0, erros: 0 };

  function executavel() {
    // Positivo vale até o fim do processo; negativo expira em 60 s (instalou depois).
    if (exeCache) return exeCache;
    if (agora() - exeCacheEm < 60_000 && exeCacheEm !== 0) return null;
    exeCacheEm = agora();
    exeCache = resolver();
    return exeCache;
  }

  async function adquirir() {
    if (ativos < concorrencia) {
      ativos += 1;
      return;
    }
    if (fila.length >= filaMax) {
      throw new ClaudeCliError('fila_cheia', `Fila do Claude CLI cheia (${filaMax}).`);
    }
    await new Promise((resolve) => fila.push(resolve));
    // `liberar` já repassou a vaga: `ativos` não mudou.
  }

  function liberar() {
    const proximo = fila.shift();
    if (proximo) proximo();
    else ativos -= 1;
  }

  function executar(exe, { modelo, sistema, prompt, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const script = ehScriptWindows(exe);
      // .cmd/.bat só rodam por shell; nesse caso nada de aspas dentro dos args:
      // o system prompt vai junto no stdin.
      const sistemaNoStdin = script || (sistema && sistema.length > SISTEMA_MAX_ARGV);
      const args = montarArgs({ modelo, sistema: sistemaNoStdin ? '' : sistema });
      const entrada = sistemaNoStdin && sistema ? `${sistema}\n\n---\n\n${prompt}` : prompt;

      let filho;
      try {
        if (script) {
          const linha = [exe, ...args].map((a) => `"${a}"`).join(' ');
          filho = spawn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${linha}"`], {
            cwd: os.tmpdir(),
            env: ambienteDoFilho(env),
            windowsHide: true,
            windowsVerbatimArguments: true,
          });
        } else {
          filho = spawn(exe, args, {
            cwd: os.tmpdir(),
            env: ambienteDoFilho(env),
            windowsHide: true,
          });
        }
      } catch (err) {
        reject(new ClaudeCliError(err?.code === 'ENOENT' ? 'ausente' : 'falhou', String(err?.message ?? err)));
        return;
      }

      let stdout = '';
      let stderr = '';
      let terminou = false;
      const terminar = (fn, valor) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(timer);
        fn(valor);
      };

      const timer = setTimeout(() => {
        try {
          filho.kill();
        } catch {
          /* já morreu */
        }
        terminar(reject, new ClaudeCliError('timeout', `Claude CLI passou de ${timeoutMs} ms.`));
      }, timeoutMs);

      filho.stdout?.on('data', (d) => {
        if (stdout.length < LIMITE_STDOUT) stdout += d;
      });
      filho.stderr?.on('data', (d) => {
        if (stderr.length < 64_000) stderr += d;
      });
      filho.on('error', (err) => {
        terminar(
          reject,
          new ClaudeCliError(err?.code === 'ENOENT' ? 'ausente' : 'falhou', String(err?.message ?? err)),
        );
      });
      filho.on('close', (codigo) => {
        const env_ = lerEnvelope(stdout.trim());
        const textoErro = `${env_?.result ?? ''}\n${env_?.error ?? ''}\n${stderr}\n${env_ ? '' : stdout}`;
        if (env_?.is_error || (codigo !== 0 && codigo !== null)) {
          const cod = classificarFalha(textoErro);
          terminar(
            reject,
            new ClaudeCliError(cod, `Claude CLI saiu com ${codigo}: ${textoErro.trim().slice(0, 300)}`),
          );
          return;
        }
        if (!env_ || typeof env_.result !== 'string') {
          terminar(reject, new ClaudeCliError('saida_invalida', 'Saída do Claude CLI não é o JSON esperado.'));
          return;
        }
        if (!env_.result.trim()) {
          terminar(reject, new ClaudeCliError('saida_invalida', 'Claude CLI respondeu vazio.'));
          return;
        }
        terminar(resolve, {
          texto: env_.result,
          custoUsd: typeof env_.total_cost_usd === 'number' ? env_.total_cost_usd : null,
          duracaoMs: typeof env_.duration_ms === 'number' ? env_.duration_ms : null,
        });
      });

      filho.stdin?.on('error', () => {
        /* o filho pode morrer antes de ler; o `close` explica */
      });
      filho.stdin?.end(entrada);
    });
  }

  /**
   * Faz UMA pergunta. `json: true` valida e devolve também `json`.
   * @returns {Promise<{texto: string, json?: unknown, modelo: string, custoUsd: number|null, duracaoMs: number|null}>}
   */
  async function perguntar({ prompt, sistema = '', modelo, json = false, timeoutMs = timeoutPadrao }) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new ClaudeCliError('falhou', 'Prompt vazio.');
    }
    if (typeof modelo !== 'string' || !MODELO_VALIDO.test(modelo)) {
      throw new ClaudeCliError('falhou', `Modelo inválido: ${String(modelo)}`);
    }
    if (pausa.ate > agora()) throw new ClaudeCliError(pausa.codigo, `${pausa.mensagem} (em pausa)`);

    await adquirir();
    stats.chamadas += 1;
    try {
      // A pausa pode ter sido armada enquanto esta chamada esperava na fila.
      if (pausa.ate > agora()) throw new ClaudeCliError(pausa.codigo, `${pausa.mensagem} (em pausa)`);
      const exe = executavel();
      if (!exe) throw new ClaudeCliError('ausente', 'Claude CLI não encontrado (defina CLAUDE_CLI_PATH).');
      const r = await executar(exe, { modelo, sistema, prompt, timeoutMs });
      const saida = { ...r, modelo };
      if (json) saida.json = extrairJson(r.texto);
      stats.ok += 1;
      return saida;
    } catch (err) {
      stats.erros += 1;
      if (err instanceof ClaudeCliError) {
        const dur = { limite: pausaLimiteMs, nao_logado: 5 * 60_000, indisponivel: 60_000 }[err.codigo];
        if (dur && !(pausa.ate > agora())) {
          pausa = { ate: agora() + dur, codigo: err.codigo, mensagem: err.message.slice(0, 200) };
          log(`claude cli: ${err.codigo} — pausa de ${Math.round(dur / 1000)}s`);
        }
        throw err;
      }
      throw new ClaudeCliError('falhou', String(err?.message ?? err));
    } finally {
      liberar();
    }
  }

  return {
    perguntar,
    /** Foto do estado, para log/diagnóstico. */
    estado: () => ({ ativos, naFila: fila.length, pausaAte: pausa.ate, pausaCodigo: pausa.codigo, ...stats }),
    /** O CLI está instalado (não garante login)? */
    disponivel: () => Boolean(executavel()),
    /** Zera a pausa (testes / reinício manual). */
    limparPausa: () => {
      pausa = { ate: 0, codigo: '', mensagem: '' };
    },
  };
}
