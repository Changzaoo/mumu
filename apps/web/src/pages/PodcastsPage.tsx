/**
 * /podcasts — catalog grid.
 */
import { Podcast } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { Skeleton } from '@/components/ui/skeleton';
import { usePodcasts } from '@/features/browse/api';

export default function PodcastsPage() {
  const { data, isLoading, isError, refetch } = usePodcasts();

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <Podcast className="size-7 text-fg-muted" /> Podcasts
        </h1>
        <p className="text-sm text-fg-muted">Conversas, histórias e ideias para acompanhar.</p>
      </header>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="w-full p-3">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState
          icon={Podcast}
          title="Nenhum podcast disponível"
          description="O catálogo de podcasts chega em breve."
        />
      )}
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {data.map((podcast) => (
            <MediaCard
              key={podcast.id}
              title={podcast.title}
              subtitle={`${podcast.publisher} · ${podcast.episodeCount} episódios`}
              imageUrl={podcast.coverUrl}
              to={`/podcast/${podcast.id}`}
              className="w-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}
