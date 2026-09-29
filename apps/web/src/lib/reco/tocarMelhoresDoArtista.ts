/**
 * Liga o `melhoresDoArtista` (puro) aos dados do app e ao player.
 *
 * Fica à parte da função pura para ela continuar testável sem stores, e para a
 * lateral, a página do artista e qualquer outro lugar tocarem a MESMA seleção.
 */
import { toast } from 'sonner';
import type { TrackDto } from '@radinho/shared';
import { rankingDoArtista } from '@/lib/artistTop';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import { melhoresDoArtista } from '@/lib/reco/melhoresDoArtista';
import { usePlayerStore } from '@/stores/playerStore';

/** A seleção do artista agora, com o ranking que já estiver em cache. */
export function faixasMelhoresDoArtista(nome: string): TrackDto[] {
  return melhoresDoArtista(localLibrary.artistTracks(nome), {
    rankingMundial: rankingDoArtista(nome),
    historico: localHistory.listForCurrentUser(),
    curtidas: localLikes.list(),
  });
}

/**
 * Adianta a busca do ranking mundial (passar o mouse, focar). Tocar não espera
 * a rede — sem isto, o primeiro play de um artista sairia na ordem pessoal.
 */
export function prepararMelhoresDoArtista(nome: string): void {
  rankingDoArtista(nome);
}

/** Toca as melhores do artista. `false` quando não há nada dele no acervo. */
export function tocarMelhoresDoArtista(nome: string): boolean {
  const faixas = faixasMelhoresDoArtista(nome);
  if (faixas.length === 0) {
    toast(`Nenhuma música de ${nome} no seu acervo ainda.`);
    return false;
  }
  usePlayerStore.getState().playQueue(faixas, 0, { source: 'artist', sourceId: nome });
  return true;
}
