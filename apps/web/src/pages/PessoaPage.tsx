/**
 * /pessoa/:chave — uma pessoa creditada (produtor, compositor, letrista…):
 * tudo o que ela fez no acervo, para navegar "quem mais ele produziu".
 * As faixas tocam quando estão no acervo do aparelho.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Play, SlidersHorizontal } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { useTrackLikes } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { ROTULO_DO_PAPEL, usePessoa } from '@/lib/mundo/creditos';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function PessoaPage() {
  const { chave = '' } = useParams<{ chave: string }>();
  const { data, isLoading } = usePessoa(decodeURIComponent(chave));
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const tracks = useMemo(() => {
    void entries;
    return (data?.faixas ?? [])
      .map((f) => localLibrary.entryFor(f.trackId)?.track ?? null)
      .filter((t): t is TrackDto => t !== null);
  }, [data, entries]);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!data) {
    return (
      <div className="py-16">
        <EmptyState
          icon={SlidersHorizontal}
          title="Sem créditos ainda"
          description="O servidor ainda não leu créditos desta pessoa no acervo."
        />
      </div>
    );
  }

  const papeis = data.papeis.map((p) => `${ROTULO_DO_PAPEL[p.papel]} (${p.faixas})`).join(' · ');
  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'library', sourceId: `pessoa:${data.chave}` })
      : undefined;
  const foraDoAparelho = data.faixas.filter((f) => !localLibrary.entryFor(f.trackId));

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
          Créditos
        </p>
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-fg">
          <SlidersHorizontal className="size-8 text-fg-muted" /> {data.nome}
        </h1>
        <p className="text-sm text-fg-muted">
          {papeis}
          {data.faixas.length > 0 &&
            ` · ${data.faixas.length} ${data.faixas.length === 1 ? 'faixa' : 'faixas'} no acervo`}
        </p>
        {data.artistas.length > 0 && (
          <p className="text-[13px] text-fg-muted">
            {data.artistas.map((a, i) => (
              <span key={`${a.artista}|${a.papel}`}>
                {i > 0 && ' · '}
                {ROTULO_DO_PAPEL[a.papel]} de{' '}
                <Link
                  to={`/artista/${encodeURIComponent(a.artista)}`}
                  className="text-fg hover:text-accent"
                >
                  {a.artista}
                </Link>
              </span>
            ))}
          </p>
        )}
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => play(0)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
          >
            <Play className="size-4 fill-current" /> Tocar
          </button>
        )}
      </header>

      {tracks.length > 0 && (
        <TrackList header aria-label={`Faixas com ${data.nome} nos créditos`}>
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              liked={likes.isLiked(track)}
              onToggleLike={(liked) => likes.toggle(track, liked)}
              onPlay={() => play(index)}
            />
          ))}
        </TrackList>
      )}

      {foraDoAparelho.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
            Também nos créditos
          </h2>
          <ul className="space-y-1 text-[13px] text-fg-muted">
            {foraDoAparelho.map((f) => (
              <li key={f.trackId}>
                <span className="text-fg">{f.titulo}</span> · {f.artista} ·{' '}
                {f.papeis.map((p) => ROTULO_DO_PAPEL[p]).join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
