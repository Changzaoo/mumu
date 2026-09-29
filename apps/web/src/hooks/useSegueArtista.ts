import { useSyncExternalStore } from 'react';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';

/** A pessoa segue este artista? Reage a seguir/deixar em qualquer lugar do app. */
export function useSegueArtista(nome: string): boolean {
  return useSyncExternalStore(
    artistasSeguidos.subscribe,
    () => artistasSeguidos.segue(nome),
    () => false,
  );
}
