import { useState } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore, type DirecaoDaTroca } from '@/stores/uiStore';

/**
 * Por quanto tempo o carimbo de direção vale. A faixa troca no mesmo instante
 * do `next()` (a carga vem depois, com a faixa nova já na tela), então um
 * segundo e meio sobra — e um carimbo de uma troca antiga não contamina a
 * próxima, que pode ser um clique numa lista, sem direção nenhuma.
 */
const CARIMBO_VALE_MS = 1_500;

interface Anterior {
  chave: string | null;
  direcao: DirecaoDaTroca;
  /** Faixa daqui que estava tocando — é ela que se procura na fila nova. */
  faixaId: string | null;
}

/**
 * De que lado a faixa `chave` entrou na tela: 1 (pela direita), -1 (pela
 * esquerda) ou 0 (sem lado — só funde).
 *
 * Quem pediu a troca com um lado claro (botão, arrasto) carimbou no `uiStore`.
 * Sem carimbo, a fila responde: se a faixa de antes está logo ATRÁS da nova, é
 * avanço (o fim natural da faixa, o "próxima" do fone ou da tela de bloqueio);
 * logo À FRENTE, é volta. Qualquer outra coisa — clicar numa faixa da lista,
 * trocar de álbum — não tem lado, e inventar um seria mentir.
 *
 * O cálculo acontece NA RENDERIZAÇÃO em que a chave muda (o padrão "guardar o
 * valor da renderização anterior" do React), porque é nela que o
 * `AnimatePresence` precisa saber de que lado a capa nova entra.
 */
export function useDirecaoDaTroca(chave: string | null): DirecaoDaTroca {
  const [anterior, setAnterior] = useState<Anterior>(() => ({
    chave,
    direcao: 0,
    faixaId: usePlayerStore.getState().currentTrack?.id ?? null,
  }));

  if (anterior.chave === chave) return anterior.direcao;

  const { queue, queueIndex, currentTrack } = usePlayerStore.getState();
  const { direcaoDaTroca, direcaoMarcadaEm } = useUiStore.getState();
  let direcao: DirecaoDaTroca = 0;
  if (Date.now() - direcaoMarcadaEm < CARIMBO_VALE_MS) {
    direcao = direcaoDaTroca;
  } else if (anterior.faixaId && queueIndex >= 0) {
    // Com "repetir tudo", a última volta para a primeira: é avanço também.
    const atras = queue[queueIndex - 1] ?? (queueIndex === 0 ? queue[queue.length - 1] : undefined);
    const frente = queue[queueIndex + 1];
    if (atras?.id === anterior.faixaId) direcao = 1;
    else if (frente?.id === anterior.faixaId) direcao = -1;
  }

  setAnterior({ chave, direcao, faixaId: currentTrack?.id ?? null });
  return direcao;
}
