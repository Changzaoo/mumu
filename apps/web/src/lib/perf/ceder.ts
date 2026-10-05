/**
 * CEDER A THREAD — devolver a vez ao navegador entre dois pedaços de trabalho.
 *
 * Cada pedaço de trabalho síncrono é UMA tarefa, e tarefa acima de 50 ms é o que
 * deixa o toque sem resposta. No aparelho real do dono (moto g34, 4 GB) o boot
 * mostrou três delas vindas do mesmo vício: ler/gravar milhares de registros do
 * IndexedDB seguidos, sem nenhum respiro entre os pedaços. Quem trabalha em
 * fatias precisa de um respiro CERTO entre elas:
 *
 *  - `scheduler.yield()` quando existe (Chrome 129+): devolve a vez E continua
 *    com a prioridade de quem pediu, sem ir para o fim da fila;
 *  - senão, `MessageChannel`: é uma tarefa nova, SEM a trava mínima de 4 ms que
 *    `setTimeout(0)` ganha depois de cinco encadeados (numa leitura de 300
 *    páginas, isso seria um segundo e meio só de espera) e sem o estrangulamento
 *    de aba em segundo plano;
 *  - senão, `setTimeout(0)`.
 *
 * Um canal por chamada, fechado ao receber: não deixa porta aberta segurando o
 * processo (testes) nem acumula ouvintes.
 */

interface Agendador {
  yield?: () => Promise<void>;
}

/** Resolve numa tarefa NOVA: tudo o que estava na fila do navegador roda antes. */
export function cederAThread(): Promise<void> {
  const agendador = (globalThis as unknown as { scheduler?: Agendador }).scheduler;
  if (typeof agendador?.yield === 'function') return agendador.yield();
  if (typeof MessageChannel !== 'undefined') {
    return new Promise<void>((resolve) => {
      const canal = new MessageChannel();
      canal.port1.onmessage = () => {
        canal.port1.close();
        resolve();
      };
      canal.port2.postMessage(0);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
