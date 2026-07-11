import type { ArtistDto } from '@aurial/shared';
import { MediaCard } from '@/components/media/MediaCard';

export interface ArtistCardProps {
  artist: Pick<ArtistDto, 'id' | 'name' | 'imageUrl'>;
  onPlay?: () => void;
  className?: string;
}

export function ArtistCard({ artist, onPlay, className }: ArtistCardProps) {
  return (
    <MediaCard
      title={artist.name}
      subtitle="Artista"
      imageUrl={artist.imageUrl}
      shape="round"
      to={`/artist/${artist.id}`}
      onPlay={onPlay}
      className={className}
    />
  );
}
