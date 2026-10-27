/**
 * O PORTÃO DO LRCLIB — todo pedido ao lrclib.net passa por aqui.
 *
 * O LRCLIB é gratuito e sem chave, e a cortesia é o único contrato. Uma faixa
 * sem letra gera até doze consultas de uma vez (título limpo × cru × dois
 * artistas × sem artista, em `get` e em `search`), e a indexação de fundo faz
 * isso para quinze faixas seguidas. No diário do Diego (27/10/2026) o LRCLIB
 * respondeu 429 trinta vezes em um minuto — e cada 429 contava como "a fonte
 * errou", o que mandava o app pedir ao importador por outras fontes, que
 * também virou rajada.
 *
 * O portão NÃO atrasa ninguém enquanto o LRCLIB está bem: os pedidos continuam
 * saindo juntos (a latência de "fila indiana" já foi medida e removida). Ele
 * só age quando o servidor reclama:
 *
 *  • 429/502/503/504 → PAUSA: pelo `Retry-After` quando vem, senão 15 s
 *    dobrando a cada episódio (teto 2 min). Durante a pausa nenhum pedido sai;
 *    quem chama recebe `null` e trata como "a fonte não respondeu" (não grava
 *    "sem letra").
 *  • depois da pausa → CAUTELA por 2 min: no máximo dois pedidos em voo, com
 *    250 ms entre disparos. Passado isso, volta ao normal.
 *
 * Ele também CONTA A HISTÓRIA: avisa 'lotado' quando entra em pausa e 'voltou'
 * na primeira resposta boa depois — é o que o médico usa para marcar no diário
 * que a doença passou.
 */

export type EventoDoLrclib =
  | { tipo: 'lotado'; status: number; esperaMs: number }
  | { tipo: 'voltou'; status: number };

export const PAUSA_BASE_MS = 15_000;
export const PAUSA_MAXIMA_MS = 120_000;
export const CAUTELA_MS = 120_000;
export const MAX_EM_VOO_NA_CAUTELA = 2;
export const ESPACO_NA_CAUTELA_MS = 250;
const LOTADO: ReadonlySet<number> = new Set([429, 502, 503, 504]);

let pausadoAte = 0;
let cautelaAte = 0;
/** Episódios de lotação seguidos sem uma resposta boa no meio: dobra a pausa. */
let episodios = 0;
/** Houve lotação e ainda não veio resposta boa depois dela. */
let doente = false;
let ouvintes: Array<(evento: EventoDoLrclib) => void> = [];

// A fila da cautela.
let emVoo = 0;
let ultimoDisparo = 0;
let agendado = false;
const esperando: Array<() => void> = [];

export interface EstadoDoLrclib {
  pausadoAteMs: number;
  cautelaAteMs: number;
  episodios: number;
  doente: boolean;
}

export function estadoDoLrclib(): EstadoDoLrclib {
  return { pausadoAteMs: pausadoAte, cautelaAteMs: cautelaAte, episodios, doente };
}

/** Avisa quando o LRCLIB lota e quando volta. Devolve o cancelamento. */
export function ouvirLrclib(ouvinte: (evento: EventoDoLrclib) => void): () => void {
  ouvintes.push(ouvinte);
  return () => {
    ouvintes = ouvintes.filter((o) => o !== ouvinte);
  };
}

/**
 * Faz o pedido respeitando pausa e cautela. `null` quando o LRCLIB está em
 * pausa (o pedido nem saiu). Erros de rede sobem como no `fetch` comum.
 */
export async function pedirAoLrclib(url: string, init?: RequestInit): Promise<Response | null> {
  const agora = Date.now();
  if (agora < pausadoAte) return null;
  const cauteloso = agora < cautelaAte;
  if (cauteloso) await minhaVez();
  try {
    const resposta = await fetch(url, init);
    if (LOTADO.has(resposta.status)) {
      lotou(resposta);
    } else if (doente && (resposta.ok || resposta.status === 404)) {
      // 404 é resposta de verdade ("não tenho"): o servidor está atendendo.
      doente = false;
      episodios = 0;
      avisar({ tipo: 'voltou', status: resposta.status });
    }
    return resposta;
  } finally {
    if (cauteloso) liberar();
  }
}

function lotou(resposta: Response): void {
  const agora = Date.now();
  // Uma rajada devolve vários 429 de uma vez: é UM episódio, não dez.
  if (agora < pausadoAte) return;
  const pedidoPeloServidor = segundosDoRetryAfter(resposta.headers.get('retry-after'));
  const espera =
    pedidoPeloServidor !== null
      ? Math.min(PAUSA_MAXIMA_MS, Math.max(1_000, pedidoPeloServidor * 1_000))
      : Math.min(PAUSA_MAXIMA_MS, PAUSA_BASE_MS * 2 ** episodios);
  episodios += 1;
  doente = true;
  pausadoAte = agora + espera;
  cautelaAte = pausadoAte + CAUTELA_MS;
  avisar({ tipo: 'lotado', status: resposta.status, esperaMs: espera });
}

function segundosDoRetryAfter(valor: string | null): number | null {
  if (!valor) return null;
  const n = Number(valor);
  if (Number.isFinite(n) && n >= 0) return n;
  const data = Date.parse(valor);
  if (Number.isFinite(data)) return Math.max(0, (data - Date.now()) / 1_000);
  return null;
}

function minhaVez(): Promise<void> {
  return new Promise((resolve) => {
    esperando.push(resolve);
    drenar();
  });
}

function drenar(): void {
  while (emVoo < MAX_EM_VOO_NA_CAUTELA && esperando.length > 0) {
    const falta = ultimoDisparo + ESPACO_NA_CAUTELA_MS - Date.now();
    if (falta > 0) {
      if (!agendado) {
        agendado = true;
        setTimeout(() => {
          agendado = false;
          drenar();
        }, falta);
      }
      return;
    }
    emVoo += 1;
    ultimoDisparo = Date.now();
    esperando.shift()?.();
  }
}

function liberar(): void {
  emVoo = Math.max(0, emVoo - 1);
  drenar();
}

function avisar(evento: EventoDoLrclib): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte(evento);
    } catch {
      /* um ouvinte quebrado não fecha o portão */
    }
  }
}

/** Só para teste. */
export function zerarPortaoDoLrclib(): void {
  pausadoAte = 0;
  cautelaAte = 0;
  episodios = 0;
  doente = false;
  ouvintes = [];
  emVoo = 0;
  ultimoDisparo = 0;
  agendado = false;
  esperando.length = 0;
}
