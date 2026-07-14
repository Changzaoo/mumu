/**
 * A round card for an artist in YOUR library — shows their REAL photo (fetched
 * once via the importer → Deezer and cached), falling back to a track cover
 * until it loads. Links to the local artist page.
 */
import { MediaCard } from '@/components/media/MediaCard';
import { useArtistImage } from '@/lib/artistImage';

export function LocalArtistCard({
  name,
  trackCount,
  fallbackImage,
}: {
  name: string;
  trackCount: number;
  fallbackImage?: string | null;
}) {
  const photo = useArtistImage(name);
  return (
    <MediaCard
      title={name}
      subtitle={`Artista • ${trackCount} ${trackCount === 1 ? 'música' : 'músicas'}`}
      shape="round"
      imageUrl={photo ?? fallbackImage ?? null}
      to={`/artista/${encodeURIComponent(name)}`}
    />
  );
}
