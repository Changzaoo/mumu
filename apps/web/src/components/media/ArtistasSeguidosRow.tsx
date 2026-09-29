/**
 * "Artistas que você segue" — a mesma lista da lateral, para quem não tem
 * lateral (celular). Some quando a pessoa não segue ninguém.
 */
import { useSyncExternalStore } from 'react';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { useArtistImage } from '@/lib/artistImage';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import {
  prepararMelhoresDoArtista,
  tocarMelhoresDoArtista,
} from '@/lib/reco/tocarMelhoresDoArtista';

const SEM_SEGUIDOS: artistasSeguidos.ArtistaSeguido[] = [];

function CartaoDoSeguido({ artista }: { artista: artistasSeguidos.ArtistaSeguido }) {
  const foto = useArtistImage(artista.nome);
  return (
    <MediaCard
      title={artista.nome}
      subtitle="Artista"
      shape="round"
      imageUrl={foto ?? artista.capaUrl}
      to={`/artista/${encodeURIComponent(artista.nome)}`}
      onPointerEnter={() => prepararMelhoresDoArtista(artista.nome)}
      onPlay={() => tocarMelhoresDoArtista(artista.nome)}
    />
  );
}

export function ArtistasSeguidosRow() {
  const seguidos = useSyncExternalStore(
    artistasSeguidos.subscribe,
    artistasSeguidos.list,
    () => SEM_SEGUIDOS,
  );
  if (seguidos.length === 0) return null;
  return (
    <SectionCarousel
      title="Artistas que você segue"
      subtitle="Toque no play para ouvir as melhores de cada um"
      loop={false}
    >
      {seguidos.map((artista) => (
        <CartaoDoSeguido key={artista.nome} artista={artista} />
      ))}
    </SectionCarousel>
  );
}
