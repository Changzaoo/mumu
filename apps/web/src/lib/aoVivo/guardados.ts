/**
 * Favoritas, recentes e podcasts seguidos — no aparelho (localStorage).
 *
 * Guarda o objeto inteiro (nome, capa, stream), não só o id: a prateleira abre
 * na hora, sem esperar o Radio Browser/Apple responder.
 */
import { useSyncExternalStore } from 'react';
import type { RadioAberta } from './radioBrowser';
import type { PodcastAberto } from './podcastsAbertos';

type Lista<T> = { chave: string; teto: number; cache: T[] | null; ouvintes: Set<() => void> };

function criar<T>(chave: string, teto: number): Lista<T> {
  return { chave, teto, cache: null, ouvintes: new Set() };
}

const favoritas = criar<RadioAberta>('radinho:radios:favoritas', 200);
const recentes = criar<RadioAberta>('radinho:radios:recentes', 24);
const seguidos = criar<PodcastAberto>('radinho:podcasts:seguidos', 300);

const VAZIA: never[] = [];

function ler<T>(lista: Lista<T>): T[] {
  if (lista.cache) return lista.cache;
  try {
    const cru = window.localStorage.getItem(lista.chave);
    lista.cache = cru ? (JSON.parse(cru) as T[]) : (VAZIA as T[]);
  } catch {
    lista.cache = VAZIA as T[];
  }
  return lista.cache;
}

function gravar<T>(lista: Lista<T>, itens: T[]): void {
  lista.cache = itens.slice(0, lista.teto);
  try {
    window.localStorage.setItem(lista.chave, JSON.stringify(lista.cache));
  } catch {
    /* cota cheia: vale só nesta aba */
  }
  lista.ouvintes.forEach((f) => f());
}

function useLista<T>(lista: Lista<T>): T[] {
  return useSyncExternalStore(
    (f) => {
      lista.ouvintes.add(f);
      return () => lista.ouvintes.delete(f);
    },
    () => ler(lista),
    () => VAZIA as T[],
  );
}

export const useRadiosFavoritas = (): RadioAberta[] => useLista(favoritas);
export const useRadiosRecentes = (): RadioAberta[] => useLista(recentes);
export const usePodcastsSeguidos = (): PodcastAberto[] => useLista(seguidos);

export function alternarFavorita(radio: RadioAberta): void {
  const atuais = ler(favoritas);
  gravar(
    favoritas,
    atuais.some((r) => r.id === radio.id)
      ? atuais.filter((r) => r.id !== radio.id)
      : [radio, ...atuais],
  );
}

export function marcarRecente(radio: RadioAberta): void {
  gravar(recentes, [radio, ...ler(recentes).filter((r) => r.id !== radio.id)]);
}

export function alternarSeguido(podcast: PodcastAberto): void {
  const atuais = ler(seguidos);
  gravar(
    seguidos,
    atuais.some((p) => p.id === podcast.id)
      ? atuais.filter((p) => p.id !== podcast.id)
      : [podcast, ...atuais],
  );
}
