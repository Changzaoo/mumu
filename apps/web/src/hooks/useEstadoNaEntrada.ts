import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'react-router';

/**
 * ESTADO DA PÁGINA QUE SOBREVIVE AO VOLTAR.
 *
 * `useState` perde tudo quando a página desmonta; voltar de um artista para a
 * Biblioteca reabria na primeira aba, com o filtro vazio. Aqui o valor fica no
 * sessionStorage amarrado à ENTRADA do histórico (`location.key`) — a mesma
 * granularidade da rolagem. Entrada nova (PUSH) começa do `inicial`; voltar
 * (POP) encontra o que a pessoa deixou. O que define a tela de fato (a busca
 * em `?q=`) continua na URL; isto é para o que é só da interface (aba, filtro).
 *
 * Só serializa JSON, e só grava quando o valor MUDA — nada por quadro.
 */
const PREFIXO = 'radinho:estado:';

function ler<T>(chave: string, inicial: T): T {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    return bruto === null ? inicial : (JSON.parse(bruto) as T);
  } catch {
    return inicial;
  }
}

export function useEstadoNaEntrada<T>(nome: string, inicial: T): [T, Dispatch<SetStateAction<T>>] {
  const { key } = useLocation();
  const chave = `${PREFIXO}${key}:${nome}`;
  const [valor, setValor] = useState<T>(() => ler(chave, inicial));

  // A mesma página pode trocar de chave sem desmontar (a busca troca a URL a
  // cada letra, com `replace`): o valor atual acompanha para a chave nova.
  useEffect(() => {
    try {
      if (Object.is(valor, inicial)) window.sessionStorage.removeItem(chave);
      else window.sessionStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* sem sessionStorage: só não volta como estava */
    }
  }, [chave, valor, inicial]);

  const definir = useCallback<Dispatch<SetStateAction<T>>>((v) => setValor(v), []);
  return [valor, definir];
}
