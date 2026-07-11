/**
 * /uploads — send your own audio: drag-and-drop / file picker, XHR multipart
 * upload with real progress, then server-side processing status polled via
 * GET /uploads/:id/status (react-query refetchInterval).
 */
import { useCallback, useRef, useState } from 'react';
import { AudioLines, FileMusic, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACCEPTED_AUDIO_EXT,
  MAX_UPLOAD_SIZE_BYTES,
  type ApiErrorBody,
  type UploadDto,
  type UploadStatus,
} from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteUpload, useUploads, useUploadStatus } from '@/features/library/api';
import { getIdToken } from '@/lib/firebase';
import { cn, formatBytes } from '@/lib/utils';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');
const ACCEPT = ACCEPTED_AUDIO_EXT.join(',');

const STATUS_LABEL: Record<UploadStatus, string> = {
  QUEUED: 'Na fila',
  PROBING: 'Verificando',
  TRANSCODING: 'Convertendo',
  ANALYZING: 'Analisando',
  READY: 'Pronto',
  FAILED: 'Falhou',
};

const STATUS_VARIANT: Record<UploadStatus, BadgeProps['variant']> = {
  QUEUED: 'default',
  PROBING: 'info',
  TRANSCODING: 'info',
  ANALYZING: 'info',
  READY: 'accent',
  FAILED: 'danger',
};

/** Multipart POST /uploads with upload progress (fetch has no progress events). */
function uploadFile(file: File, onProgress: (percent: number) => void): Promise<UploadDto> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let token: string | null = null;
      try {
        token = await getIdToken();
      } catch {
        // Anonymous upload attempt — server decides.
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}/uploads`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        try {
          const payload: unknown = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve((payload as { data: UploadDto }).data);
          } else {
            const body = payload as Partial<ApiErrorBody>;
            reject(new Error(body.error?.message ?? `Falha no envio (${xhr.status}).`));
          }
        } catch {
          reject(new Error('Resposta inesperada do servidor.'));
        }
      };
      xhr.onerror = () => reject(new Error('Não foi possível conectar ao servidor.'));
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    })();
  });
}

interface PendingUpload {
  key: string;
  fileName: string;
  sizeBytes: number;
  progress: number;
  error: string | null;
}

function ProgressBar({ value, failed = false }: { value: number; failed?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          failed ? 'bg-danger' : 'bg-accent',
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/** One server-side upload row — polls status while processing. */
function UploadRow({ upload, onDelete }: { upload: UploadDto; onDelete: (u: UploadDto) => void }) {
  const { data } = useUploadStatus(upload);
  const current = data ?? upload;
  const processing = current.status !== 'READY' && current.status !== 'FAILED';

  return (
    <li className="flex items-center gap-4 rounded-xl border border-border bg-bg-elevated p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-fg/5 text-fg-muted">
        <FileMusic className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="line-clamp-1 text-sm font-medium text-fg">{current.fileName}</p>
          <Badge variant={STATUS_VARIANT[current.status]}>
            {processing && <Loader2 className="size-3 animate-spin" />}
            {STATUS_LABEL[current.status]}
          </Badge>
        </div>
        {processing && <ProgressBar value={current.progress} />}
        <p className="text-xs text-fg-muted">
          {formatBytes(current.sizeBytes)} ·{' '}
          {new Date(current.createdAt).toLocaleDateString('pt-BR')}
          {current.status === 'FAILED' && current.error && (
            <span className="text-danger"> · {current.error}</span>
          )}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Excluir ${current.fileName}`}
        onClick={() => onDelete(current)}
        className="grid size-9 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

export default function UploadsPage() {
  const { data: uploads, isLoading, isError, refetch } = useUploads();
  const deleteUpload = useDeleteUpload();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [toDelete, setToDelete] = useState<UploadDto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startUpload = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
        if (!(ACCEPTED_AUDIO_EXT as readonly string[]).includes(ext)) {
          toast.error(`Formato não suportado: ${file.name}`);
          continue;
        }
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          toast.error(`${file.name} passa do limite de ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.`);
          continue;
        }
        const key = `${file.name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        setPending((old) => [
          { key, fileName: file.name, sizeBytes: file.size, progress: 0, error: null },
          ...old,
        ]);
        uploadFile(file, (progress) =>
          setPending((old) => old.map((p) => (p.key === key ? { ...p, progress } : p))),
        )
          .then(() => {
            setPending((old) => old.filter((p) => p.key !== key));
            toast('Envio concluído — processando');
            void refetch();
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha no envio.';
            setPending((old) => old.map((p) => (p.key === key ? { ...p, error: message } : p)));
          });
      }
    },
    [refetch],
  );

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <UploadCloud className="size-7 text-fg-muted" /> Seus uploads
        </h1>
        <p className="max-w-lg text-sm text-fg-muted">
          Envie suas faixas ({ACCEPTED_AUDIO_EXT.join(', ')}). Elas são convertidas para streaming e
          entram na sua biblioteca.
        </p>
      </header>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Enviar arquivos de áudio"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (event.dataTransfer.files.length > 0) startUpload(event.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors duration-200',
          dragOver
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-fg/25 hover:bg-fg/[0.03]',
        )}
      >
        <span
          className={cn(
            'grid size-12 place-items-center rounded-full transition-colors duration-200',
            dragOver ? 'bg-accent/15 text-accent' : 'bg-fg/5 text-fg-subtle',
          )}
        >
          <AudioLines className="size-6" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-fg">
            {dragOver ? 'Solte para enviar' : 'Arraste arquivos de áudio aqui'}
          </p>
          <p className="text-[13px] text-fg-muted">
            ou <span className="font-medium text-accent">escolha no dispositivo</span> · até{' '}
            {formatBytes(MAX_UPLOAD_SIZE_BYTES)} por arquivo
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0)
              startUpload(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {/* In-flight uploads */}
      {pending.length > 0 && (
        <ul className="space-y-3" aria-label="Envios em andamento">
          {pending.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-4 rounded-xl border border-border bg-bg-elevated p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-fg/5 text-fg-muted">
                {item.error ? (
                  <FileMusic className="size-5" />
                ) : (
                  <Loader2 className="size-5 animate-spin" />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="line-clamp-1 text-sm font-medium text-fg">{item.fileName}</p>
                  {item.error ? (
                    <Badge variant="danger">Falhou</Badge>
                  ) : (
                    <Badge variant="info">Enviando {item.progress}%</Badge>
                  )}
                </div>
                <ProgressBar
                  value={item.error ? 100 : item.progress}
                  failed={Boolean(item.error)}
                />
                <p className="text-xs text-fg-muted">
                  {formatBytes(item.sizeBytes)}
                  {item.error && <span className="text-danger"> · {item.error}</span>}
                </p>
              </div>
              {item.error && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPending((old) => old.filter((p) => p.key !== item.key))}
                >
                  Dispensar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Server uploads */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {uploads && uploads.length === 0 && pending.length === 0 && (
        <EmptyState
          icon={UploadCloud}
          title="Nenhum upload ainda"
          description="Seus arquivos enviados aparecem aqui com o status de processamento."
        />
      )}
      {uploads && uploads.length > 0 && (
        <ul className="space-y-3" aria-label="Uploads enviados">
          {uploads.map((upload) => (
            <UploadRow key={upload.id} upload={upload} onDelete={setToDelete} />
          ))}
        </ul>
      )}

      {/* Delete confirm */}
      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir upload</DialogTitle>
            <DialogDescription>
              {toDelete
                ? `"${toDelete.fileName}" e a faixa gerada serão removidos. Essa ação não pode ser desfeita.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUpload.isPending}
              onClick={() => {
                if (!toDelete) return;
                deleteUpload.mutate(toDelete.id, { onSettled: () => setToDelete(null) });
              }}
            >
              {deleteUpload.isPending && <Loader2 className="animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
