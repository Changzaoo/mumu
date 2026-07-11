/**
 * / — Home: greeting, "Continuar ouvindo" resume cards and server-driven
 * sections (HomeDto.sections → carousel or grid by layout hint).
 */
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { Compass, Play } from 'lucide-react';
import type { ContinueListeningDto, HomeSectionDto, HomeSectionItem } from '@aurial/shared';
import { ArtistCard } from '@/components/media/ArtistCard';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlaylistCard } from '@/components/media/PlaylistCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { buttonVariants } from '@/components/ui/button';
import { radioToTrack } from '@/features/browse/api';
import { useHome } from '@/features/home/api';
import { ApiError } from '@/lib/api';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** One resume card: art, titles and a thin progress underline. */
function ContinueCard({ entry }: { entry: ContinueListeningDto }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const seek = usePlayerStore((s) => s.seek);
  const progress =
    entry.track.durationMs > 0 ? Math.min(1, entry.positionMs / entry.track.durationMs) : 0;

  const resume = (): void => {
    playTrack(entry.track, { source: 'home' });
    // Resume point: the engine applies seeks after load; if the underlying
    // Howl ignores pre-load seeks this is a no-op (TODO: engine `load` could
    // accept an initialSeek option — integration seam).
    seek(entry.positionMs / 1000);
  };

  return (
    <button
      type="button"
      onClick={resume}
      aria-label={`Continuar ouvindo ${entry.track.title}`}
      className={cn(
        'group flex w-64 shrink-0 snap-start items-center gap-3 overflow-hidden rounded-xl bg-bg-elevated p-2 pr-3 text-left',
        'border border-border transition-colors duration-200 hover:bg-fg/5',
      )}
    >
      <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-fg/6">
        {entry.track.coverUrl && (
          <img
            src={entry.track.coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <Play className="size-4 fill-current text-white" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-fg">{entry.track.title}</span>
        <span className="line-clamp-1 text-xs text-fg-muted">
          {entry.contextTitle ?? trackArtistNames(entry.track)}
        </span>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-fg/10">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      </span>
    </button>
  );
}

function HomeItemCard({ item }: { item: HomeSectionItem }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  switch (item.kind) {
    case 'track':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={trackArtistNames(item.item)}
          imageUrl={item.item.coverUrl}
          to={item.item.album ? `/album/${item.item.album.id}` : undefined}
          playing={currentTrack?.id === item.item.id && isPlaying}
          onPlay={() => playTrack(item.item, { source: 'home' })}
        />
      );
    case 'album':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={item.item.artists.map((a) => a.name).join(', ')}
          imageUrl={item.item.coverUrl}
          to={`/album/${item.item.id}`}
        />
      );
    case 'artist':
      return <ArtistCard artist={item.item} />;
    case 'playlist':
      return <PlaylistCard playlist={item.item} />;
    case 'podcast':
      return (
        <MediaCard
          title={item.item.title}
          subtitle={item.item.publisher}
          imageUrl={item.item.coverUrl}
          to={`/podcast/${item.item.id}`}
        />
      );
    case 'radio':
      return (
        <MediaCard
          title={item.item.name}
          subtitle={item.item.genre ? `Rádio · ${item.item.genre}` : 'Rádio ao vivo'}
          imageUrl={item.item.imageUrl}
          to="/radios"
          playing={currentTrack?.id === `radio:${item.item.id}` && isPlaying}
          onPlay={() =>
            playTrack(radioToTrack(item.item), { source: 'radio', sourceId: item.item.id })
          }
        />
      );
  }
}

function itemKey(item: HomeSectionItem): string {
  return `${item.kind}:${item.item.id}`;
}

function HomeSection({ section }: { section: HomeSectionDto }) {
  if (section.items.length === 0) return null;

  if (section.layout === 'grid') {
    return (
      <section>
        <header className="mb-3 px-3">
          <h2 className="text-xl font-semibold tracking-tight text-fg">{section.title}</h2>
          {section.subtitle && (
            <p className="mt-0.5 text-[13px] text-fg-muted">{section.subtitle}</p>
          )}
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {section.items.map((item) => (
            <HomeItemCard key={itemKey(item)} item={item} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <SectionCarousel title={section.title} subtitle={section.subtitle ?? undefined}>
      {section.items.map((item) => (
        <HomeItemCard key={itemKey(item)} item={item} />
      ))}
    </SectionCarousel>
  );
}

export default function HomePage() {
  const { data, isLoading, isError, error, refetch } = useHome();

  if (isLoading) return <PageSkeleton variant="home" />;

  if (isError) {
    const apiError = error instanceof ApiError ? error : null;
    // Offline / signed-out demo mode: invite exploration instead of failing.
    if (apiError && (apiError.status === 0 || apiError.status === 401)) {
      return (
        <div className="space-y-8 py-4">
          <h1 className="px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl">
            {localGreeting()}
          </h1>
          <EmptyState
            icon={Compass}
            title="Modo demonstração"
            description="Suas recomendações aparecem aqui quando você entra na sua conta. Enquanto isso, explore o catálogo."
            action={
              <Link to="/search" className={buttonVariants({ variant: 'accent', size: 'md' })}>
                Explorar músicas
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8 py-4">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl"
      >
        {data.greeting || localGreeting()}
      </motion.h1>

      {data.continueListening.length > 0 && (
        <section aria-label="Continuar ouvindo">
          <h2 className="mb-3 px-3 text-xl font-semibold tracking-tight text-fg">
            Continuar ouvindo
          </h2>
          <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-3 pb-1">
            {data.continueListening.map((entry) => (
              <ContinueCard key={entry.track.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {data.sections.map((section) => (
        <HomeSection key={section.id} section={section} />
      ))}

      {data.continueListening.length === 0 && data.sections.length === 0 && (
        <EmptyState
          icon={Compass}
          title="Tudo pronto para começar"
          description="Ouça algumas músicas e sua página inicial ganha vida."
          action={
            <Link to="/search" className={buttonVariants({ variant: 'accent', size: 'md' })}>
              Explorar músicas
            </Link>
          }
        />
      )}
    </div>
  );
}
