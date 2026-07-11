/**
 * /downloads — offline listening.
 *
 * Lists tracks whose audio is cached on the device (Cache Storage API, managed
 * by features/downloads/downloadManager.ts). Downloaded tracks play with no
 * network connection; the player prefers the local copy automatically.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CloudDownload, HardDrive, Trash2, WifiOff } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Button } from '@/components/ui/button';
import {
  getDownloads,
  subscribeDownloads,
  totalDownloadedBytes,
  type DownloadEntry,
} from '@/features/downloads/registry';
import {
  downloadsSupported,
  removeDownloadedTrack,
  subscribeDownloadManager,
} from '@/features/downloads/downloadManager';
import { estimateStorage } from '@/lib/offline/audioCache';
import { useTrackLikes } from '@/features/library/api';
import { useOnline } from '@/hooks/useOnline';
import { formatBytes } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: DownloadEntry[] = [];

export default function DownloadsPage() {
  const downloads = useSyncExternalStore(subscribeDownloads, getDownloads, () => EMPTY);
  // Re-render when a download completes/removes (manager owns object URLs).
  useSyncExternalStore(subscribeDownloadManager, () => downloads.length, () => 0);
  const likes = useTrackLikes();
  const online = useOnline();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void estimateStorage().then(setQuota);
  }, [downloads.length]);

  const supported = downloadsSupported();
  const tracks = downloads.map((entry) => entry.track);
  const totalBytes = totalDownloadedBytes();

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <CloudDownload className="size-7 text-fg-muted" /> Downloads
          </h1>
          <p className="max-w-lg text-sm text-fg-muted">
            Faixas guardadas no dispositivo para ouvir sem conexão. O player usa a cópia local
            automaticamente, mesmo offline.
          </p>
          {downloads.length > 0 && (
            <p className="flex items-center gap-1.5 text-[13px] text-fg-subtle">
              <HardDrive className="size-3.5" />
              {downloads.length} {downloads.length === 1 ? 'faixa' : 'faixas'} ·{' '}
              {formatBytes(totalBytes)}
              {quota && quota.quota > 0 && ` de ${formatBytes(quota.quota)} disponíveis`}
            </p>
          )}
        </div>
        {downloads.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              for (const entry of downloads) void removeDownloadedTrack(entry.track.id);
            }}
          >
            <Trash2 /> Limpar tudo
          </Button>
        )}
      </header>

      {!online && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-elevated/60 px-4 py-3 text-sm text-fg-muted">
          <WifiOff className="size-4 text-accent" />
          Você está offline — apenas as faixas baixadas estão disponíveis.
        </div>
      )}

      {!supported && (
        <div className="rounded-xl border border-border bg-bg-elevated/60 px-4 py-3 text-sm text-fg-muted">
          Downloads offline exigem uma conexão segura (HTTPS) ou o app instalado. Acesse o Aurial por
          HTTPS para baixar faixas.
        </div>
      )}

      {downloads.length === 0 ? (
        <EmptyState
          icon={CloudDownload}
          title="Nenhum download ainda"
          description={
            supported
              ? 'Abra o menu de uma faixa e escolha “Baixar para ouvir offline”.'
              : 'Disponível ao acessar o Aurial por HTTPS.'
          }
        />
      ) : (
        <TrackList aria-label="Faixas baixadas">
          {downloads.map((entry, index) => (
            <TrackRow
              key={entry.track.id}
              track={entry.track}
              index={index}
              active={entry.track.id === currentTrack?.id}
              playing={entry.track.id === currentTrack?.id && isPlaying}
              liked={likes.isLiked(entry.track)}
              onToggleLike={(liked) => likes.toggle(entry.track, liked)}
              onPlay={() => playQueue(tracks, index, { source: 'library', sourceId: 'downloads' })}
            />
          ))}
        </TrackList>
      )}
    </div>
  );
}
