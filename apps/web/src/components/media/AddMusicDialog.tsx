import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPlaylistUrl } from '@/lib/local/importerHelper';
import * as localLibrary from '@/lib/local/localLibrary';

/**
 * Common-user "add music" — a hardened way to import by link (incl. YouTube
 * playlists) or upload an audio file. Files are magic-byte validated and all
 * derived text/URLs are sanitized in the library layer, so a renamed/booby-
 * trapped file can never do anything but be rejected.
 */
export function AddMusicDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLink = async (): Promise<void> => {
    const link = url.trim();
    if (!link || busy) return;
    const playlist = isPlaylistUrl(link);
    setBusy(true);
    const id = toast.loading(playlist ? 'Lendo playlist…' : 'Baixando e convertendo…');
    try {
      if (playlist) {
        const { imported, total } = await localLibrary.addPlaylistByUrl(link, (done, tot) =>
          toast.loading(`Baixando playlist… ${done}/${tot}`, { id }),
        );
        toast.success(`Playlist importada — ${imported}/${total} faixas`, { id });
      } else {
        const track = await localLibrary.addByUrl(link);
        toast.success(`“${track.title}” adicionada`, { id });
      }
      setUrl('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível adicionar.', { id });
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const id = toast.loading('Importando…');
    try {
      const imported = await localLibrary.importFiles(files);
      if (imported.length > 0) {
        toast.success(
          imported.length === 1
            ? `“${imported[0]?.title}” adicionada`
            : `${imported.length} faixas adicionadas`,
          { id },
        );
        onOpenChange(false);
      } else {
        toast.error('Nenhum arquivo de áudio válido.', { id });
      }
    } catch {
      toast.error('Não foi possível importar.', { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar música</DialogTitle>
          <DialogDescription>
            Cole o link de uma música ou playlist (YouTube, SoundCloud, Vimeo, Bandcamp) ou envie um
            arquivo de áudio do seu aparelho.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addLink()}
              placeholder="Cole o link aqui"
              inputMode="url"
              spellCheck={false}
            />
            <Button variant="accent" disabled={busy || !url.trim()} onClick={() => void addLink()}>
              {busy ? <Loader2 className="animate-spin" /> : 'Adicionar'}
            </Button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-fg-subtle">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload /> Enviar arquivo de áudio
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <p className="text-[11px] leading-relaxed text-fg-subtle">
            Apenas áudio (MP3, M4A, FLAC, WAV, OGG…). Arquivos são verificados antes de entrar.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
