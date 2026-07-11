import type { ComponentProps } from 'react';
import { CloudOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps extends ComponentProps<'div'> {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Inline retry card (DESIGN §9): errors never take over the page —
 * a quiet card with a single retry action.
 */
export function ErrorState({
  title = 'Algo saiu do compasso',
  description = 'Não foi possível carregar este conteúdo. Verifique sua conexão e tente novamente.',
  onRetry,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-bg-elevated p-8 text-center',
        className,
      )}
      {...props}
    >
      <span className="grid size-12 place-items-center rounded-full bg-fg/5 text-fg-subtle">
        <CloudOff className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="text-[13px] text-fg-muted">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
          <RotateCcw /> Tentar novamente
        </Button>
      )}
    </div>
  );
}
