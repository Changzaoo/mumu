/**
 * Diálogo de compartilhamento (Spotify-style): um card bonito com a capa, o
 * tipo e o título do conteúdo + link público /s/:id para copiar ou enviar via
 * share nativo. Abra de qualquer lugar com `openShare(payload)` — o host
 * (`<ShareDialogHost/>`, montado no AppShell) cuida do resto.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, Music, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { AurialMark } from '@/components/brand/AurialMark';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createShare, type SharePayload } from '@/lib/share/share';

let openListener: ((payload: SharePayload) => void) | null = null;

/** Abre o diálogo de compartilhamento com esse conteúdo. */
export function openShare(payload: SharePayload): void {
  openListener?.(payload);
}

export function ShareDialogHost() {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    openListener = (p) => {
      setPayload(p);
      setUrl(null);
      setCopied(false);
      void createShare(p).then((link) => {
        setUrl(link);
        if (!link) toast.error('Entre na sua conta para compartilhar.');
      });
    };
    return () => {
      openListener = null;
    };
  }, []);

  const copy = async (): Promise<void> => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast('Link copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  const nativeShare = async (): Promise<void> => {
    if (!url || !payload) return;
    try {
      await navigator.share({ title: payload.title, text: payload.subtitle, url });
    } catch {
      /* usuário cancelou */
    }
  };

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && setPayload(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Compartilhar</DialogTitle>
        </DialogHeader>
        {payload && (
          <div className="space-y-4">
            {/* O card (Spotify-style) */}
            <div className="overflow-hidden rounded-2xl bg-linear-to-br from-violet-600 via-indigo-600 to-blue-500 p-6 text-white shadow-2xl">
              <div className="mx-auto size-40 overflow-hidden rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                {payload.coverUrl ? (
                  <img src={payload.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center bg-white/10">
                    <Music className="size-10" />
                  </div>
                )}
              </div>
              <p className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                {payload.type}
              </p>
              <p className="mt-1 line-clamp-2 text-center text-xl font-bold leading-tight">
                {payload.title}
              </p>
              <p className="mt-0.5 line-clamp-1 text-center text-[13px] text-white/75">
                {payload.subtitle}
              </p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white/80">
                <AurialMark /> radinho.online
              </div>
            </div>

            {/* Link + ações */}
            <div className="flex items-center gap-2">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3">
                {url ? (
                  <>
                    <Link2 className="size-4 shrink-0 text-fg-subtle" />
                    <span className="truncate text-[13px] text-fg-muted">{url}</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" />
                    <span className="text-[13px] text-fg-subtle">Gerando link…</span>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={!url}
                onClick={() => void copy()}
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-transform hover:scale-105 disabled:opacity-50"
                aria-label="Copiar link"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
              {'share' in navigator && (
                <button
                  type="button"
                  disabled={!url}
                  onClick={() => void nativeShare()}
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-border text-fg transition-colors hover:bg-fg/5 disabled:opacity-50"
                  aria-label="Compartilhar via apps"
                >
                  <Share2 className="size-4" />
                </button>
              )}
            </div>
            <p className="text-center text-[12px] text-fg-muted">
              Quem abrir o link ouve na hora — sem conta, prévias de 30s.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
