import { Link } from 'react-router';
import { AurialMark } from '@/components/brand/AurialMark';
import { buttonVariants } from '@/components/ui/button';

/** 404 — quiet, on-brand, one action (DESIGN voice: no exclamation marks). */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
      <AurialMark className="size-10 opacity-60" />
      <div className="space-y-2">
        <p className="font-mono text-sm tabular-nums tracking-widest text-fg-subtle">404</p>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Esta página saiu da playlist</h1>
        <p className="mx-auto max-w-sm text-sm text-fg-muted">
          O endereço não existe ou foi movido. A música continua no início.
        </p>
      </div>
      <Link to="/" className={buttonVariants({ variant: 'accent', size: 'md' })}>
        Voltar ao início
      </Link>
    </div>
  );
}
