/**
 * /downloads — offline listening (PWA seam).
 *
 * Lists tracks marked for offline via the localStorage registry
 * (features/downloads/registry.ts). The actual audio caching is a
 * service-worker concern — documented TODO in the registry.
 */
import { useSyncExternalStore } from 'react';
import { CloudDownload, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  clearDownloads,
  getDownloads,
  removeDownload,
  subscribeDownloads,
  type DownloadEntry,
} from '@/features/downloads/registry';
import { useTrackLikes } from '@/features/library/api';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: DownloadEntry[] = [];

export default function DownloadsPage() {
  const downloads = useSyncExternalStore(subscribeDownloads, getDownloads, () => EMPTY);
  const likes = useTrackLikes();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const tracks = downloads.map((entry) => entry.track);

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <CloudDownload className="size-7 text-fg-muted" /> Downloads
          </h1>
          <p className="max-w-lg text-sm text-fg-muted">
            Faixas marcadas para ouvir offline. Como app instalado (PWA), o Aurial guarda o áudio no
            dispositivo e toca mesmo sem conexão.
          </p>
        </div>
        {downloads.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearDownloads}>
            <Trash2 /> Limpar tudo
          </Button>
        )}
      </header>

      {downloads.length === 0 ? (
        <EmptyState
          icon={CloudDownload}
          title="Nenhum download ainda"
          description="Use o menu de uma faixa para disponibilizá-la offline."
        />
      ) : (
        <TrackList aria-label="Faixas baixadas">
          {downloads.map((entry, index) => (
            <div key={entry.track.id} className="group/dl relative">
              <TrackRow
                track={entry.track}
                index={index}
                active={entry.track.id === currentTrack?.id}
                playing={entry.track.id === currentTrack?.id && isPlaying}
                liked={likes.isLiked(entry.track)}
                onToggleLike={(liked) => likes.toggle(entry.track, liked)}
                onPlay={() =>
                  playQueue(tracks, index, { source: 'library', sourceId: 'downloads' })
                }
                className="pr-10"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Remover ${entry.track.title} dos downloads`}
                    onClick={() => removeDownload(entry.track.id)}
                    className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-fg-muted opacity-0 transition-opacity duration-200 hover:text-danger group-hover/dl:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Baixada em {new Date(entry.downloadedAt).toLocaleDateString('pt-BR')}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </TrackList>
      )}
    </div>
  );
}
