/**
 * /podcast/:id — hero + episode list (description clamp, duration, play).
 */
import { useParams } from 'react-router';
import { Play, Podcast } from 'lucide-react';
import type { EpisodeDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { episodeToTrack, usePodcast, usePodcastEpisodes } from '@/features/browse/api';
import { cn, formatDurationLong } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function EpisodeRow({
  episode,
  podcast,
  index,
}: {
  episode: EpisodeDto;
  podcast: { id: string; title: string };
  index: number;
}) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = currentTrack?.id === `episode:${episode.id}`;

  const play = (): void => {
    if (active) {
      toggle();
      return;
    }
    playTrack(episodeToTrack(episode, podcast), { source: 'podcast', sourceId: podcast.id });
  };

  return (
    <li
      className={cn(
        'group flex gap-4 rounded-xl border border-border bg-bg-elevated p-4 transition-colors duration-200 hover:bg-fg/5',
        active && 'border-accent/40',
      )}
    >
      <span className="hidden pt-1 font-mono text-[13px] tabular-nums text-fg-subtle sm:block">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn('line-clamp-1 text-sm font-medium', active ? 'text-accent' : 'text-fg')}>
          {episode.title}
        </p>
        {episode.description && (
          <p className="line-clamp-2 text-[13px] text-fg-muted">{episode.description}</p>
        )}
        <p className="pt-1 text-xs text-fg-subtle">
          {new Date(episode.publishedAt).toLocaleDateString('pt-BR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {' · '}
          {formatDurationLong(episode.durationMs)}
        </p>
      </div>
      <PlayButton
        playing={active && isPlaying}
        onClick={play}
        size="sm"
        className="self-center opacity-70 transition-opacity group-hover:opacity-100"
        aria-label={active && isPlaying ? `Pausar ${episode.title}` : `Reproduzir ${episode.title}`}
      />
    </li>
  );
}

export default function PodcastPage() {
  const { id = '' } = useParams<{ id: string }>();
  const podcast = usePodcast(id);
  const episodes = usePodcastEpisodes(id);
  const playTrack = usePlayerStore((s) => s.playTrack);

  if (podcast.isLoading) return <PageSkeleton variant="detail" />;
  if (podcast.isError || !podcast.data) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void podcast.refetch()} />
      </div>
    );
  }

  const info = podcast.data;
  const firstEpisode = episodes.data?.[0];

  return (
    <div className="space-y-6 py-4">
      <HeroHeader
        type="Podcast"
        title={info.title}
        imageUrl={info.coverUrl}
        meta={
          <>
            <span className="font-medium text-fg">{info.publisher}</span>
            <span aria-hidden>·</span>
            <span>{info.episodeCount} episódios</span>
          </>
        }
        actions={
          firstEpisode && (
            <button
              type="button"
              onClick={() =>
                playTrack(episodeToTrack(firstEpisode, info), {
                  source: 'podcast',
                  sourceId: info.id,
                })
              }
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-accent-fg transition-transform duration-200 hover:scale-[1.03] active:scale-95"
            >
              <Play className="size-4 fill-current" /> Episódio mais recente
            </button>
          )
        }
      >
        {info.description && (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted">{info.description}</p>
        )}
      </HeroHeader>

      <section aria-label="Episódios" className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight text-fg">Episódios</h2>
        {episodes.isLoading && <PageSkeleton variant="list" className="py-0" />}
        {episodes.isError && <ErrorState onRetry={() => void episodes.refetch()} />}
        {episodes.data && episodes.data.length === 0 && (
          <EmptyState
            icon={Podcast}
            title="Nenhum episódio publicado"
            description="Os episódios aparecem aqui assim que forem lançados."
          />
        )}
        {episodes.data && episodes.data.length > 0 && (
          <ul className="space-y-3">
            {episodes.data.map((episode, index) => (
              <EpisodeRow key={episode.id} episode={episode} podcast={info} index={index} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
