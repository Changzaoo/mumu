/**
 * /dispositivo — "No dispositivo": the on-device local library. Import audio
 * files (drag-drop / picker) or add by a direct file URL into Cache Storage,
 * auto-enrich real covers/metadata from iTunes, recreate a playlist from a
 * pasted track list, play everything through the shared engine (fully offline),
 * and share over P2P. Tracks received from peers also land here.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  HardDrive,
  HardDriveDownload,
  ImageDown,
  Link2,
  ListMusic,
  ListPlus,
  Loader2,
  Music,
  Pause,
  Play,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { CommunityTracksRow } from '@/components/media/CommunityTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { searchSongs } from '@/lib/catalog/itunes';
import { appleSongToDto } from '@/lib/catalog/mapApple';
import * as localLibrary from '@/lib/local/localLibrary';
import { isPlaylistUrl } from '@/lib/local/importerHelper';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { estimateStorage } from '@/lib/offline/audioCache';
import { cn, formatBytes, formatDuration } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];
const EMPTY_LISTS: localPlaylists.LocalPlaylist[] = [];

/** Resolve a list of "Título - Artista" lines to cover-rich iTunes tracks, in
 * small concurrent batches to be gentle on the endpoint. */
async function tracksFromList(
  text: string,
  onProgress: (done: number, total: number) => void,
): Promise<TrackDto[]> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 300);
  const out: TrackDto[] = [];
  let done = 0;
  const BATCH = 5;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (line) => {
        try {
          const songs = await searchSongs(line, 'br', 1);
          return songs[0] ? appleSongToDto(songs[0]) : null;
        } catch {
          return null;
        } finally {
          done++;
          onProgress(done, lines.length);
        }
      }),
    );
    for (const t of results) if (t) out.push(t);
  }
  return out;
}

export default function DevicePage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const lists = useSyncExternalStore(
    localPlaylists.subscribe,
    localPlaylists.list,
    () => EMPTY_LISTS,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);

  const [linkUrl, setLinkUrl] = useState('');
  const [addingLink, setAddingLink] = useState(false);

  const [listOpen, setListOpen] = useState(false);
  const [listTitle, setListTitle] = useState('Músicas Curtidas');
  const [listText, setListText] = useState('');
  const [listBusy, setListBusy] = useState<{ done: number; total: number } | null>(null);

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

  const addLink = async (): Promise<void> => {
    const url = linkUrl.trim();
    if (!url) return;
    const playlist = isPlaylistUrl(url);
    setAddingLink(true);
    const toastId = toast.loading(playlist ? 'Lendo playlist…' : 'Baixando e convertendo…');
    try {
      if (playlist) {
        const { imported, total } = await localLibrary.addPlaylistByUrl(url, (done, tot) => {
          toast.loading(`Baixando playlist… ${done}/${tot}`, { id: toastId });
        });
        toast.success(`Playlist importada — ${imported}/${total} faixas`, { id: toastId });
      } else {
        const track = await localLibrary.addByUrl(url);
        toast.success(`“${track.title}” adicionada`, { id: toastId });
      }
      setLinkUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível adicionar esse link.', {
        id: toastId,
      });
    } finally {
      setAddingLink(false);
    }
  };

  const createList = async (): Promise<void> => {
    if (!listText.trim() || listBusy) return;
    setListBusy({ done: 0, total: 0 });
    try {
      const found = await tracksFromList(listText, (done, total) => setListBusy({ done, total }));
      if (found.length === 0) {
        toast.error('Nenhuma música encontrada. Confira a lista.');
        return;
      }
      localPlaylists.create(listTitle, found);
      toast.success(`Lista criada com ${found.length} música(s).`);
      setListOpen(false);
      setListText('');
    } catch {
      toast.error('Não foi possível criar a lista.');
    } finally {
      setListBusy(null);
    }
  };

  return (
    <div className="space-y-8 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <HardDriveDownload className="size-7 text-fg-muted" /> No dispositivo
          </h1>
          <p className="max-w-lg text-sm text-fg-muted">
            Suas músicas ficam guardadas neste aparelho e tocam mesmo sem conexão. Importe arquivos,
            adicione por link ou recrie uma playlist a partir de uma lista.
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

      {/* Add: files, link, list */}
      <div className="grid gap-4 md:grid-cols-2">
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

        {/* Link + list */}
        <div className="flex flex-col gap-4">
          <div className="glass space-y-2 rounded-xl border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <Link2 className="size-4 text-fg-muted" /> Adicionar por link
            </p>
            <p className="text-[13px] text-fg-muted">
              Cole o link de uma música — ou de uma playlist do YouTube — do YouTube, SoundCloud,
              Vimeo, Bandcamp ou de um arquivo de áudio. Baixamos e guardamos no aparelho.
            </p>
            <div className="flex gap-2">
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addLink()}
                placeholder="Cole o link aqui"
                inputMode="url"
              />
              <Button
                variant="accent"
                size="sm"
                disabled={addingLink || !linkUrl.trim()}
                onClick={() => void addLink()}
              >
                {addingLink ? <Loader2 className="animate-spin" /> : 'Adicionar'}
              </Button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="glass flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-fg/5"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
              <ListPlus className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">
                Recriar playlist a partir de uma lista
              </span>
              <span className="block text-[13px] text-fg-muted">
                Cole os nomes das músicas — montamos com as capas reais.
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* Link-imported tracks shared by the community. */}
      <CommunityTracksRow limit={20} />

      {/* My lists */}
      {lists.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <ListMusic className="size-5 text-fg-muted" /> Minhas listas
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {lists.map((list) => {
              const listTracks = localPlaylists.resolveTracks(list.id);
              const cover = listTracks.find((t) => t.coverUrl)?.coverUrl ?? null;
              return (
                <div
                  key={list.id}
                  className="group relative overflow-hidden rounded-xl border border-border bg-bg-elevated/60 p-3 transition-colors hover:bg-fg/5"
                >
                  <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-fg/6">
                    {cover ? (
                      <img src={cover} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-fg-subtle">
                        <ListMusic className="size-8" />
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Tocar ${list.title}`}
                      onClick={() =>
                        listTracks.length > 0 &&
                        playQueue(listTracks, 0, { source: 'library', sourceId: list.id })
                      }
                      className="absolute bottom-2 right-2 grid size-10 translate-y-1 place-items-center rounded-full bg-accent text-accent-fg opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"
                    >
                      <Play className="ml-0.5 size-5 fill-current" />
                    </button>
                  </div>
                  <p className="line-clamp-1 text-sm font-medium text-fg">{list.title}</p>
                  <p className="flex items-center justify-between text-[12px] text-fg-muted">
                    <span>{list.trackIds.length} músicas</span>
                    <button
                      type="button"
                      aria-label={`Excluir ${list.title}`}
                      onClick={() => {
                        localPlaylists.remove(list.id);
                        toast('Lista excluída');
                      }}
                      className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Device tracks */}
      <section className="space-y-3">
        {entries.length > 0 && (
          <h2 className="text-lg font-semibold tracking-tight text-fg">Faixas no dispositivo</h2>
        )}
        {entries.length === 0 ? (
          <EmptyState
            icon={Music}
            title="Sua biblioteca está vazia"
            description="Importe seus arquivos, adicione por link ou receba faixas de amigos em Compartilhar."
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
                  <div className="flex items-center gap-1">
                    {!track.coverUrl && (
                      <IconButton
                        aria-label={`Buscar capa de ${track.title}`}
                        title="Buscar capa"
                        size="sm"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => {
                          void toast.promise(localLibrary.enrichLocalTrack(track.id), {
                            loading: 'Buscando capa…',
                            success: (ok) => (ok ? 'Capa encontrada' : 'Sem correspondência'),
                            error: 'Falha ao buscar',
                          });
                        }}
                      >
                        <ImageDown />
                      </IconButton>
                    )}
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
      </section>

      {/* Create-from-list dialog */}
      <Dialog open={listOpen} onOpenChange={(o) => !listBusy && setListOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recriar playlist</DialogTitle>
            <DialogDescription>
              Cole uma música por linha, no formato “Título - Artista”. Buscamos a capa e o nome
              reais de cada uma. Tocam em prévia de 30s; para ouvir completo e offline, importe seus
              arquivos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={listTitle}
              onChange={(e) => setListTitle(e.target.value)}
              placeholder="Nome da lista"
              disabled={!!listBusy}
            />
            <Textarea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              placeholder={
                'Paint The Town Red - Doja Cat\nRunnin - 21 Savage, Metro Boomin\nEnjoy the Silence - Depeche Mode'
              }
              rows={8}
              disabled={!!listBusy}
              className="resize-none"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-fg-muted">
                {listBusy
                  ? `Buscando ${listBusy.done}/${listBusy.total}…`
                  : `${listText.split('\n').filter((l) => l.trim()).length} música(s)`}
              </span>
              <Button
                variant="accent"
                disabled={!!listBusy || !listText.trim()}
                onClick={() => void createList()}
              >
                {listBusy ? <Loader2 className="animate-spin" /> : 'Criar lista'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
