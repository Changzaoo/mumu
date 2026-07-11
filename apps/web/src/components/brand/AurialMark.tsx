import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** The Aurial mark — a waveform arc forming an "A" (single accent color). */
export function AurialMark({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn('size-7 text-accent', className)}
      {...props}
    >
      <path
        d="M6.5 26 L16 6.5 L25.5 26"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.8 21.4 v2.4 M16 19.2 v6.8 M19.2 21.4 v2.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
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
        <span className="select-none text-lg font-semibold tracking-tight text-fg">Aurial</span>
      )}
    </span>
  );
}
