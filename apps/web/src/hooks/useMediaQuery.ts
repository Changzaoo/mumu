import { useSyncExternalStore } from 'react';

/**
 * UMA MediaQueryList POR CONSULTA, para o app inteiro.
 *
 * `window.matchMedia` cria (e analisa) uma lista nova a cada chamada, e o
 * `getSnapshot` roda em TODO render de TODO componente que usa o hook — cada
 * botão de play pergunta "(pointer: coarse)", cada animação pergunta pelo
 * movimento reduzido. Medido no perfil de CPU do boot: `matchMedia` entre as
 * maiores fatias nativas. A lista é reaproveitada; o navegador a mantém viva.
 */
const listas = new Map<string, MediaQueryList>();

function listaDe(query: string): MediaQueryList {
  let lista = listas.get(query);
  if (!lista) {
    lista = window.matchMedia(query);
    listas.set(query, lista);
  }
  return lista;
}

/** Reactive CSS media query. `useMediaQuery('(min-width: 1024px)')`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = listaDe(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    () => listaDe(query).matches,
    () => false,
  );
}
