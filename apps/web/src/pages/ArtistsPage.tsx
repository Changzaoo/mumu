/**
 * /artistas — every artist across your library, most tracks first. Tapping one
 * opens their page (/artista/:name) with all their songs and albums.
 */
import { useSyncExternalStore } from 'react';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import * as localLibrary from '@/lib/local/localLibrary';

const EMPTY: ReturnType<typeof localLibrary.list> = [];

export default function ArtistsPage() {
  // Re-render whenever the library changes; artists() derives from it.
  useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const artists = localLibrary.artists();

  return (
    <div className="space-y-6 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <Users className="size-7 text-fg-muted" /> Artistas
      </h1>

      {artists.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum artista ainda"
          description="Importe ou adicione músicas — os artistas aparecem aqui automaticamente."
        />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {artists.map((artist) => (
            <LocalArtistCard
              key={artist.name}
              name={artist.name}
              trackCount={artist.trackCount}
              fallbackImage={artist.coverUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
