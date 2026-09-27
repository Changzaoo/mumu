import type { TrackDto } from '@radinho/shared';
import { MediaCard, type MediaCardProps } from '@/components/media/MediaCard';
import { ContextoDaFaixa } from '@/components/media/TrackRow';

/**
 * Cartão de UMA FAIXA, com o menu da faixa no botão direito (computador) ou
 * segurando o dedo (celular) — o mesmo menu do "…" das linhas.
 */
export function CartaoDeFaixa({ track, ...props }: MediaCardProps & { track: TrackDto }) {
  return (
    <ContextoDaFaixa track={track}>
      <MediaCard trackId={track.id} {...props} />
    </ContextoDaFaixa>
  );
}
