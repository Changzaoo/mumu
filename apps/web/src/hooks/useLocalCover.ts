import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TrackDto } from '@radinho/shared';
import {
  ensureLocalCoverUrl,
  hasLocalCover,
  subscribe,
  versaoDaBiblioteca,
} from '@/lib/local/localLibrary';

/**
 * A capa desta faixa, reabrindo do cofre se a alça tiver sido despejada.
 *
 * ── POR QUE ISTO PRECISA EXISTIR ──
 *
 * A capa embutida mora no IndexedDB e chega à tela como uma ALÇA de blob, e
 * alça é a coisa cara: ela segura o arquivo inteiro vivo. Numa biblioteca
 * grande, segurar todas ao mesmo tempo era a conta que fazia a aba passar de
 * 1,4 GB, então `alcasDeBlob` passou a ter orçamento — e orçamento significa
 * que a alça de uma capa que saiu de vista pode ter sido solta.
 *
 * Sem este gancho, a faixa despejada mostraria o ícone padrão até a próxima
 * abertura do app: a memória ficaria certa e a tela ficaria errada. Aqui a
 * imagem volta assim que a linha aparece de novo, lendo do disco (barato: só
 * essa capa) em vez de manter milhares abertas por precaução.
 *
 * Perguntar TAMBÉM conta como uso: a capa que está na tela é, por definição, a
 * mais recentemente usada, e por isso nunca é a candidata a despejo. É o que
 * mantém as capas estáveis enquanto a lista rola.
 */
export function useLocalCover(track: Pick<TrackDto, 'id' | 'coverUrl'>): string | null {
  const daFaixa = track.coverUrl ?? null;
  const [doCofre, setDoCofre] = useState<string | null>(null);
  // PERGUNTAR DE NOVO QUANDO A BIBLIOTECA MUDAR.
  //
  // "Esta faixa tem capa guardada?" é uma resposta que muda no meio do boot: a
  // lista já está na tela quando o índice de capas termina de ser montado. Sem
  // esta versão nas dependências, o efeito abaixo nunca tornava a perguntar e a
  // faixa ficava com o ícone padrão até o app ser reaberto — com a imagem ali,
  // no disco, o tempo todo.
  const versao = useSyncExternalStore(subscribe, versaoDaBiblioteca);

  useEffect(() => {
    // A entrada já traz capa: ou uma URL de catálogo (iTunes/Deezer), que não
    // passa por cofre nenhum, ou uma alça VIVA desta sessão. Alça morta de
    // outra sessão não chega aqui — `restoreEmbeddedCovers` a substitui ou a
    // zera no boot, e o despejo zera a dele na hora. Desconfiar de `blob:` neste
    // ponto só acrescentaria um piscar de ícone padrão em toda linha.
    if (daFaixa || !hasLocalCover(track.id)) {
      setDoCofre(null);
      return;
    }
    let vivo = true;
    void ensureLocalCoverUrl(track.id).then((url) => {
      if (vivo) setDoCofre(url);
    });
    return () => {
      vivo = false;
    };
  }, [track.id, daFaixa, versao]);

  return daFaixa ?? doCofre;
}
