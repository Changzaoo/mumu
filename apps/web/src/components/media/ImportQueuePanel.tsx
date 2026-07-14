/**
 * Live status of the background link-import queue. Renders nothing when the
 * queue is empty; otherwise lists each link with its state and lets you retry a
 * failure or clear the finished ones. Mounted under the "Adicionar por link"
 * card so the admin can watch downloads progress while pasting more links.
 */
import { useSyncExternalStore } from 'react';
import { CheckCircle2, Clock, Loader2, RotateCw, X, XCircle } from 'lucide-react';
import * as importQueue from '@/lib/local/importQueue';

const EMPTY: importQueue.ImportItem[] = [];

function StatusIcon({ status }: { status: importQueue.ImportStatus }) {
  if (status === 'downloading')
    return <Loader2 className="size-4 shrink-0 animate-spin text-accent" />;
  if (status === 'done') return <CheckCircle2 className="size-4 shrink-0 text-accent" />;
  if (status === 'error') return <XCircle className="size-4 shrink-0 text-danger" />;
  return <Clock className="size-4 shrink-0 text-fg-subtle" />;
}

export function ImportQueuePanel() {
  const items = useSyncExternalStore(importQueue.subscribe, importQueue.list, () => EMPTY);
  const pauseReason = useSyncExternalStore(
    importQueue.subscribe,
    importQueue.pauseReason,
    () => null,
  );
  if (items.length === 0) return null;

  const s = importQueue.stats();
  const inFlight = s.pending + s.downloading;

  return (
    <div className="mt-1 rounded-lg border border-border bg-bg/40 p-3">
      {pauseReason && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md bg-fg/6 px-2.5 py-2">
          <p className={`text-[13px] ${pauseReason === 'auth' ? 'text-danger' : 'text-fg-muted'}`}>
            {pauseReason === 'auth'
              ? 'Fila pausada: entre na sua conta para baixar'
              : 'Fila pausada por falhas seguidas — tentando de novo em instantes'}
          </p>
          <button
            type="button"
            onClick={importQueue.resume}
            className="shrink-0 text-[12px] font-medium text-accent transition-opacity hover:opacity-80"
          >
            Retomar agora
          </button>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-medium text-fg">
          {inFlight > 0
            ? `Fila · ${s.downloading} baixando, ${s.pending} na espera`
            : `Fila concluída · ${s.done} baixada(s)${s.error ? `, ${s.error} com erro` : ''}`}
        </p>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={importQueue.clearFinished}
            className="text-[12px] text-fg-muted transition-colors hover:text-fg"
          >
            Limpar concluídos
          </button>
          <button
            type="button"
            onClick={importQueue.cancelAll}
            className="text-[12px] font-medium text-danger transition-opacity hover:opacity-80"
          >
            Cancelar tudo
          </button>
        </span>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-[13px]">
            <StatusIcon status={item.status} />
            <span
              className="line-clamp-1 min-w-0 flex-1 text-fg-muted"
              title={item.error ?? item.title ?? item.url}
            >
              {item.status === 'pending' && item.error ? item.error : (item.title ?? item.url)}
            </span>
            {item.status === 'error' && (
              <button
                type="button"
                aria-label="Tentar novamente"
                onClick={() => importQueue.retry(item.id)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-fg/8 hover:text-fg"
              >
                <RotateCw className="size-3.5" />
              </button>
            )}
            {item.status !== 'downloading' && (
              <button
                type="button"
                aria-label="Remover da fila"
                onClick={() => importQueue.remove(item.id)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-fg/8 hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
