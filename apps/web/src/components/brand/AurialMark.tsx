import type { ComponentProps } from 'react';
import { Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The radinho mark — a little radio (single accent color). */
export function AurialMark({ className, ...props }: ComponentProps<'svg'>) {
  return <Radio aria-hidden className={cn('size-7 text-accent', className)} {...props} />;
}

export interface AurialLogoProps extends ComponentProps<'span'> {
  /** Hide the wordmark (collapsed sidebar). */
  markOnly?: boolean;
}

export function AurialLogo({ markOnly = false, className, ...props }: AurialLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} {...props}>
      <AurialMark />
      {!markOnly && (
        <span className="select-none text-lg font-semibold tracking-tight text-fg">
          radinho
          <span className="text-fg-subtle">.online</span>
        </span>
      )}
    </span>
  );
}
