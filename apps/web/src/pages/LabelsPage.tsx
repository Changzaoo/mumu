import { useSyncExternalStore } from 'react';
import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { MediaCard } from '@/components/media/MediaCard';
import * as localLibrary from '@/lib/local/localLibrary';

const EMPTY: ReturnType<typeof localLibrary.list> = [];

export default function LabelsPage() {
  useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const labels = localLibrary.labelGroups();

  return (
    <div className="space-y-6 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <Building2 className="size-7 text-fg-muted" /> Gravadoras
      </h1>

      {labels.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma gravadora ainda"
          description="Conforme as músicas forem identificadas, as gravadoras aparecem aqui."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {labels.map((label) => (
            <MediaCard
              key={label.name}
              title={label.name}
              subtitle={`${label.tracks.length} ${label.tracks.length === 1 ? 'música' : 'músicas'}`}
              imageUrl={label.coverUrl}
              to={`/gravadora/${encodeURIComponent(label.name)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
