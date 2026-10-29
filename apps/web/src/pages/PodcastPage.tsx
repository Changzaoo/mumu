/**
 * /podcast/:id — hero + episode list (description clamp, duration, play).
 *
 * Id só de dígitos = podcast do diretório da Apple (lib/aoVivo/podcastsAbertos),
 * lido direto do aparelho; o resto vem da API do radinho.
 */
import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, Podcast } from 'lucide-react';
import type { EpisodeDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { episodeToTrack, usePodcast, usePodcastEpisodes } from '@/features/browse/api';
import { alternarSeguido, usePodcastsSeguidos } from '@/lib/aoVivo/guardados';
import { ehPodcastAberto, podcastComEpisodios } from '@/lib/aoVivo/podcastsAbertos';
import { cn, formatDurationLong } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function EpisodeRow({
  episode,
  index,
  onPlay,
}: {
  episode: EpisodeDto;
  index: number;
  onPlay: () => void;
}) {
  const toggle = usePlayerStore((s) => s.toggle);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = currentTrack?.id === `episode:${episode.id}`;

  const play = (): void => {
    if (active) {
      toggle();
      return;
    }
    onPlay();
  };
  const [aberto, setAberto] = useState(false);

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
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className={cn(
              'block whitespace-pre-line text-left text-[13px] text-fg-muted',
              !aberto && 'line-clamp-2',
            )}
          >
            {episode.description}
          </button>
        )}
        <p className="pt-1 text-xs text-fg-subtle">
          {new Date(episode.publishedAt).toLocaleDateString('pt-BR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {episode.durationMs > 0 && (
            <>
              {' · '}
              {formatDurationLong(episode.durationMs)}
            </>
          )}
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
  const daApple = ehPodcastAberto(id);
  const doRadinho = usePodcast(id, !daApple);
  const episodiosDoRadinho = usePodcastEpisodes(id, !daApple);
  const aberto = useQuery({
    queryKey: ['apple-podcasts', 'podcast', id],
    enabled: daApple,
    staleTime: 30 * 60_000,
    queryFn: () => podcastComEpisodios(id),
  });
  const podcast = daApple ? { ...aberto, data: aberto.data?.podcast } : doRadinho;
  const episodes = daApple ? { ...aberto, data: aberto.data?.episodios } : episodiosDoRadinho;
  const playQueue = usePlayerStore((s) => s.playQueue);
  const seguidos = usePodcastsSeguidos();

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
  const seguindo = seguidos.some((p) => p.id === info.id);
  /** Toca o episódio e deixa os seguintes da lista na fila. */
  const tocarDe = (index: number): void => {
    const lista = (episodes.data ?? []).filter((e) => e.streamUrl);
    const alvo = episodes.data?.[index];
    const inicio = alvo ? lista.indexOf(alvo) : 0;
    playQueue(
      lista.map((e) => episodeToTrack(e, info)),
      Math.max(0, inicio),
      { source: 'podcast', sourceId: info.id },
    );
  };

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
          <div className="flex flex-wrap items-center gap-3">
            {firstEpisode && (
              <button
                type="button"
                onClick={() => tocarDe(0)}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-accent-fg transition-transform duration-200 hover:scale-[1.03] active:scale-95"
              >
                <Play className="size-4 fill-current" /> Episódio mais recente
              </button>
            )}
            {daApple && aberto.data && (
              <button
                type="button"
                aria-pressed={seguindo}
                onClick={() => alternarSeguido(aberto.data.podcast)}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium text-fg transition-colors hover:bg-fg/5"
              >
                {seguindo ? <Check className="size-4" /> : <Plus className="size-4" />}
                {seguindo ? 'Seguindo' : 'Seguir'}
              </button>
            )}
          </div>
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
              <EpisodeRow
                key={episode.id}
                episode={episode}
                index={index}
                onPlay={() => tocarDe(index)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
