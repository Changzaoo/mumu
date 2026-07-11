/**
 * /radios — live stations grid. Clicking a card starts the live stream
 * (RadioStationDto mapped to a TrackDto-shaped object via radioToTrack).
 */
import { RadioTower } from 'lucide-react';
import type { RadioStationDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PlayButton } from '@/components/media/PlayButton';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { radioToTrack, useRadios } from '@/features/browse/api';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function RadioCard({ radio }: { radio: RadioStationDto }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = currentTrack?.id === `radio:${radio.id}`;

  const play = (): void => playTrack(radioToTrack(radio), { source: 'radio', sourceId: radio.id });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ouvir rádio ${radio.name}`}
      onClick={play}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          play();
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-bg-elevated p-4 transition-colors duration-200 hover:bg-fg/5',
        active && 'border-accent/40',
      )}
    >
      <div className="relative mb-3 aspect-square overflow-hidden rounded-lg bg-fg/6">
        {radio.imageUrl ? (
          <img
            src={radio.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-fg-subtle">
            <RadioTower className="size-8" />
          </div>
        )}
        {radio.isLive && (
          <Badge variant="danger" className="absolute left-2 top-2 gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
            Ao vivo
          </Badge>
        )}
        <PlayButton
          playing={active && isPlaying}
          onClick={(event) => {
            event.stopPropagation();
            if (active) usePlayerStore.getState().toggle();
            else play();
          }}
          className={cn(
            'absolute bottom-2 right-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-200',
            'group-hover:translate-y-0 group-hover:opacity-100',
            active && 'translate-y-0 opacity-100',
          )}
        />
      </div>
      <p className={cn('line-clamp-1 text-sm font-medium', active ? 'text-accent' : 'text-fg')}>
        {radio.name}
      </p>
      <p className="line-clamp-1 text-[13px] text-fg-muted">
        {[radio.genre, radio.country].filter(Boolean).join(' · ') || 'Rádio'}
      </p>
    </div>
  );
}

export default function RadiosPage() {
  const { data, isLoading, isError, refetch } = useRadios();

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <RadioTower className="size-7 text-fg-muted" /> Rádios
        </h1>
        <p className="text-sm text-fg-muted">Estações ao vivo do mundo inteiro, sem pausa.</p>
      </header>

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="rounded-xl border border-border p-4">
              <Skeleton className="mb-3 aspect-square rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState
          icon={RadioTower}
          title="Nenhuma estação disponível"
          description="As rádios chegam em breve por aqui."
        />
      )}
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.map((radio) => (
            <RadioCard key={radio.id} radio={radio} />
          ))}
        </div>
      )}
    </div>
  );
}
