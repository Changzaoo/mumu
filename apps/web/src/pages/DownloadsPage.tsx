/**
 * /downloads — offline listening.
 *
 * Lists tracks whose audio is cached on the device (Cache Storage API, managed
 * by features/downloads/downloadManager.ts). Downloaded tracks play with no
 * network connection; the player prefers the local copy automatically.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CloudDownload, HardDrive, Headphones, Trash2, WifiOff } from 'lucide-react';
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
  const todas = useSyncExternalStore(subscribeDownloads, getDownloads, () => EMPTY);
  // Duas listas, um só cofre: o que a pessoa PEDIU para baixar e o que ficou
  // aqui por ter sido OUVIDO (ver `guardarAoOuvir`). As ouvidas tocam do
  // aparelho do mesmo jeito; só não são protegidas do despejo por espaço.
  const downloads = useMemo(() => todas.filter((e) => e.automatico !== true), [todas]);
  const ouvidas = useMemo(() => todas.filter((e) => e.automatico === true), [todas]);
  const bytesDasOuvidas = ouvidas.reduce((soma, e) => soma + (e.sizeBytes || 0), 0);
  // Re-render when a download completes/removes (manager owns object URLs).
  useSyncExternalStore(
    subscribeDownloadManager,
    () => todas.length,
    () => 0,
  );
  const likes = useTrackLikes();
  const online = useOnline();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void estimateStorage().then(setQuota);
  }, [todas.length]);

  const supported = downloadsSupported();
  const tracks = downloads.map((entry) => entry.track);
  const totalBytes = totalDownloadedBytes() - bytesDasOuvidas;

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
          Este navegador não permite armazenamento offline — os downloads ficam indisponíveis aqui.
        </div>
      )}

      {downloads.length === 0 && ouvidas.length === 0 ? (
        <EmptyState
          icon={CloudDownload}
          title="Nenhum download ainda"
          description={
            supported
              ? 'Abra o menu de uma faixa e escolha “Baixar para ouvir offline”. O que você ouve também fica guardado aqui sozinho.'
              : 'Armazenamento offline indisponível neste navegador.'
          }
        />
      ) : downloads.length === 0 ? null : (
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

      {ouvidas.length > 0 && (
        <section className="space-y-3">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-xl font-semibold text-fg">
                <Headphones className="size-5 text-fg-muted" /> Guardadas ao ouvir
              </h2>
              <p className="max-w-lg text-[13px] text-fg-subtle">
                Tudo o que você ouve fica no aparelho e toca na hora da próxima vez.{' '}
                {ouvidas.length} {ouvidas.length === 1 ? 'faixa' : 'faixas'} ·{' '}
                {formatBytes(bytesDasOuvidas)}. Quando o espaço acaba, as menos ouvidas saem
                sozinhas; para proteger uma, use “Baixar para ouvir offline”.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const entry of ouvidas) void removeDownloadedTrack(entry.track.id);
              }}
            >
              <Trash2 /> Limpar ouvidas
            </Button>
          </header>
          <TrackList aria-label="Faixas guardadas ao ouvir">
            {ouvidas.map((entry, index) => (
              <TrackRow
                key={entry.track.id}
                track={entry.track}
                index={index}
                active={entry.track.id === currentTrack?.id}
                playing={entry.track.id === currentTrack?.id && isPlaying}
                liked={likes.isLiked(entry.track)}
                onToggleLike={(liked) => likes.toggle(entry.track, liked)}
                onPlay={() =>
                  playQueue(
                    ouvidas.map((e) => e.track),
                    index,
                    { source: 'library', sourceId: 'ouvidas' },
                  )
                }
              />
            ))}
          </TrackList>
        </section>
      )}
    </div>
  );
}
