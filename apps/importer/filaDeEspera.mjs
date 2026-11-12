/**
 * FILA DE ESPERA DA RECONSTRUÇÃO — o pedido que chega com a vaga ocupada.
 *
 * Medido em produção em 12/11/2026: três faixas respondiam 503 "reconstruindo"
 * dez minutos depois do primeiro pedido, e o log não tinha UMA linha de
 * reconstrução para elas. O servidor roda com `MAX_RECONSTRUCOES=1` (Celeron,
 * 3,4 GB), e quem chegava com a vaga ocupada recebia `'ocupado'` e era
 * esquecido: a reconstrução só começava se alguém pedisse a mesma faixa de
 * novo, por sorte, num instante em que a vaga estivesse livre. O 503 prometia
 * "estou refazendo" e ninguém estava.
 *
 * A fila é pequena e de propósito:
 *  - sem repetição: a mesma faixa pedida dez vezes ocupa um lugar só;
 *  - a ÚLTIMA pedida sai primeiro: é a que alguém acabou de apertar para
 *    ouvir, e vale mais do que a pedida há dez minutos;
 *  - com teto: quando enche, quem sai é a mais antiga — fila sem teto num
 *    servidor que não dá conta vira lista de espera infinita.
 *
 * Função pura, sem relógio nem disco: quem chama decide quando puxar.
 */
export function criarFilaDeEspera({ teto = 50 } = {}) {
  const limite = Math.max(1, Math.floor(teto));
  /** Map preserva a ordem de entrada: o último `set` é o mais recente. */
  const itens = new Map();

  return {
    /** Põe (ou devolve ao topo) e diz quem foi descartado por falta de lugar. */
    entrar(id, valor) {
      itens.delete(id);
      itens.set(id, valor);
      const descartados = [];
      while (itens.size > limite) {
        const maisAntigo = itens.keys().next().value;
        itens.delete(maisAntigo);
        descartados.push(maisAntigo);
      }
      return descartados;
    },
    /** O pedido mais recente, já fora da fila; `null` quando não há. */
    proximo() {
      let ultimo = null;
      for (const par of itens) ultimo = par;
      if (!ultimo) return null;
      itens.delete(ultimo[0]);
      return { id: ultimo[0], valor: ultimo[1] };
    },
    /** Tira da fila quem já não precisa (reconstruída por outro caminho). */
    sair(id) {
      return itens.delete(id);
    },
    tem(id) {
      return itens.has(id);
    },
    get tamanho() {
      return itens.size;
    },
  };
}
