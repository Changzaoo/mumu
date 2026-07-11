import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends ComponentProps<'span'> {
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-7' } as const;

/** Only for actions in-flight — content loading uses Skeletons (DESIGN §9). */
export function Spinner({ className, size = 'md', ...props }: SpinnerProps) {
  return (
    <span role="status" aria-label="Carregando" className={cn('inline-flex', className)} {...props}>
      <Loader2 className={cn('animate-spin text-fg-muted', sizes[size])} />
    </span>
  );
}
