import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export interface SeparatorProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

/** 1px hairline (DESIGN: borders are always 1px). */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
