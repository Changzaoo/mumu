/**
 * O ESPELHO DO ACERVO NA BORDA — para o app ficar de pé sem este servidor.
 *
 * A música mora no GitHub e o app na Vercel; a única peça que precisava do
 * notebook para a Home ter o que tocar era a listagem `/api/v1/catalogo`. Este
 * agente copia a listagem (a mesma que o controller entrega, sem campos de
 * servidor) para a borda do áudio (`PUT <AUDIO_BORDA_URL>/acervo`, o Worker em
 * infra/cdn/github-worker), que a guarda no KV e a serve em `GET /acervo` com a
 * `remoteUrl` de cada faixa remontada pelo índice do GitHub. Quando a API cai,
 * o app (apps/web/src/lib/sync/catalogoApi.ts) carrega dali.
 *
 * Só manda quando o ETag mudou desde o último envio: a listagem muda poucas
 * vezes por dia, e o KV cobra por escrita. Falha nunca derruba nada: na
 * próxima batida tenta de novo. Sem `ESPELHO_TOKEN` o agente nem sobe.
 */
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { listCatalog } from '../modules/catalog/catalog.repository.js';

const log = logger.child({ worker: 'espelhoDoAcervo' });

const INTERVALO_MS = 20 * 60_000;
const PRIMEIRA_MS = 30_000;
const TIMEOUT_MS = 60_000;

export interface Deps {
  listar?: typeof listCatalog;
  fetch?: typeof fetch;
  bordaUrl?: string | null;
  token?: string | null;
}

/** Última listagem enviada com sucesso (por ETag). */
let enviadoEtag: string | null = null;

/** Só para os testes. */
export function esquecerUltimoEnvio(): void {
  enviadoEtag = null;
}

function bordaDoEnv(): string | null {
  const v = (env as Record<string, unknown>).AUDIO_BORDA_URL;
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    return new URL(v.trim()).origin;
  } catch {
    return null;
  }
}

function tokenDoEnv(): string | null {
  const v = (env as Record<string, unknown>).ESPELHO_TOKEN;
  return typeof v === 'string' && v.trim().length >= 16 ? v.trim() : null;
}

export type Resultado =
  | { enviou: true; faixas: number; etag: string }
  | {
      enviou: false;
      motivo: 'sem-borda' | 'sem-token' | 'sem-mudanca' | 'vazio' | `http ${number}` | 'falhou';
    };

/** Uma batida: lista, compara o ETag e envia se mudou. Nunca lança. */
export async function espelharUmaVez(deps: Deps = {}): Promise<Resultado> {
  const bordaUrl = deps.bordaUrl === undefined ? bordaDoEnv() : deps.bordaUrl;
  const token = deps.token === undefined ? tokenDoEnv() : deps.token;
  if (!bordaUrl) return { enviou: false, motivo: 'sem-borda' };
  if (!token) return { enviou: false, motivo: 'sem-token' };
  const listar = deps.listar ?? listCatalog;
  const f = deps.fetch ?? fetch;
  try {
    const { entries, etag } = await listar();
    if (entries.length === 0) return { enviou: false, motivo: 'vazio' };
    if (etag === enviadoEtag) return { enviou: false, motivo: 'sem-mudanca' };
    const controlador = new AbortController();
    const prazo = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    try {
      const res = await f(`${bordaUrl}/acervo`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'radinho-api',
        },
        body: JSON.stringify({ data: entries }),
        signal: controlador.signal,
      });
      if (!res.ok) return { enviou: false, motivo: `http ${res.status}` };
      enviadoEtag = etag;
      return { enviou: true, faixas: entries.length, etag };
    } finally {
      clearTimeout(prazo);
    }
  } catch (err) {
    log.warn({ err }, 'espelho do acervo falhou');
    return { enviou: false, motivo: 'falhou' };
  }
}

/** Sobe o laço. Devolve a parada, no mesmo contrato dos outros agentes. */
export function startEspelhoDoAcervoWorker(): () => void {
  if (!tokenDoEnv() || !bordaDoEnv()) {
    log.info('espelho do acervo desligado (sem ESPELHO_TOKEN ou AUDIO_BORDA_URL)');
    return () => undefined;
  }
  let parado = false;
  let rodando = false;
  const bater = (): void => {
    if (parado || rodando) return;
    rodando = true;
    void espelharUmaVez()
      .then((r) => {
        if (r.enviou) log.info({ faixas: r.faixas, etag: r.etag }, 'acervo espelhado na borda');
        else if (r.motivo !== 'sem-mudanca') log.warn({ motivo: r.motivo }, 'acervo não espelhado');
      })
      .finally(() => {
        rodando = false;
      });
  };
  const primeira = setTimeout(bater, PRIMEIRA_MS);
  const timer = setInterval(bater, INTERVALO_MS);
  primeira.unref?.();
  timer.unref?.();
  log.info({ intervaloMin: INTERVALO_MS / 60_000 }, 'espelho do acervo iniciado');
  return () => {
    parado = true;
    clearTimeout(primeira);
    clearInterval(timer);
  };
}
