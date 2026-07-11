/**
 * /dispositivo — "No dispositivo": the on-device local library. Import audio
 * files (drag-drop / picker) into Cache Storage, play them through the shared
 * engine (fully offline), remove them, and see storage usage. Tracks received
 * from peers over P2P also land here.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  HardDrive,
  HardDriveDownload,
  Music,
  Pause,
  Play,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import * as localLibrary from '@/lib/local/localLibrary';
import { estimateStorage } from '@/lib/offline/audioCache';
import { cn, formatBytes, formatDuration } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

export default function DevicePage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);

  useEffect(() => {
    void estimateStorage().then(setQuota);
  }, [entries.length]);

  const tracks = entries.map((e) => e.track);

  const importFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const imported = await localLibrary.importFiles(files);
      if (imported.length > 0) {
        toast.success(
          imported.length === 1
            ? `“${imported[0]?.title}” adicionada`
            : `${imported.length} faixas adicionadas`,
        );
      } else {
        toast.error('Nenhum arquivo de áudio válido.');
      }
    } catch {
      toast.error('Não foi possível importar os arquivos.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <HardDriveDownload className="size-7 text-fg-muted" /> No dispositivo
          </h1>
          <p className="max-w-lg text-sm text-fg-muted">
            Suas músicas ficam guardadas neste aparelho e tocam mesmo sem conexão. Importe arquivos
            ou receba faixas de amigos.
          </p>
          {entries.length > 0 && (
            <p className="flex items-center gap-1.5 text-[13px] text-fg-subtle">
              <HardDrive className="size-3.5" />
              {entries.length} {entries.length === 1 ? 'faixa' : 'faixas'} ·{' '}
              {formatBytes(localLibrary.totalBytes())}
              {quota && quota.quota > 0 && ` de ${formatBytes(quota.quota)} disponíveis`}
            </p>
          )}
        </div>
        <Link
          to="/compartilhar"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-fg transition-colors hover:bg-fg/5"
        >
          <Share2 className="size-4" /> Compartilhar
        </Link>
      </header>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'glass flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center transition-colors duration-200',
          dragging && 'border-accent bg-accent/5',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-fg/5 text-fg-subtle">
          <Upload className="size-6" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-fg">Arraste arquivos de áudio aqui</p>
          <p className="text-[13px] text-fg-muted">MP3, FLAC, WAV, M4A, OGG e mais</p>
        </div>
        <Button
          variant="accent"
          size="sm"
          disabled={importing}
          onClick={() => inputRef.current?.click()}
        >
          {importing ? 'Importando…' : 'Escolher arquivos'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={Music}
          title="Sua biblioteca está vazia"
          description="Importe seus arquivos ou receba faixas de amigos em Compartilhar."
        />
      ) : (
        <div role="list" aria-label="Faixas no dispositivo" className="space-y-0.5">
          {entries.map((entry, index) => {
            const track = entry.track;
            const active = track.id === currentTrack?.id;
            return (
              <div
                key={track.id}
                role="listitem"
                className="group grid h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 transition-colors duration-200 hover:bg-fg/5"
              >
                <button
                  type="button"
                  aria-label={active && isPlaying ? 'Pausar' : `Reproduzir ${track.title}`}
                  onClick={() =>
                    active
                      ? toggle()
                      : playQueue(tracks, index, { source: 'library', sourceId: 'device' })
                  }
                  className="grid size-8 place-items-center justify-self-center rounded-full text-fg transition-colors hover:text-accent"
                >
                  {active && isPlaying ? (
                    <Pause className="size-4 fill-current text-accent" />
                  ) : (
                    <Play className="ml-0.5 size-4 fill-current" />
                  )}
                </button>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm bg-fg/6 text-fg-subtle">
                    {track.coverUrl ? (
                      <img src={track.coverUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <Music className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'line-clamp-1 text-sm font-medium',
                        active ? 'text-accent' : 'text-fg',
                      )}
                    >
                      {track.title}
                    </p>
                    <p className="line-clamp-1 text-[13px] text-fg-muted">
                      {track.artists[0]?.name ?? 'Desconhecido'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] tabular-nums text-fg-muted">
                    {track.durationMs > 0 ? formatDuration(track.durationMs) : '—'}
                  </span>
                  <IconButton
                    aria-label={`Remover ${track.title}`}
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => {
                      void localLibrary.remove(track.id);
                      toast('Faixa removida');
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
