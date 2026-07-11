import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm text-fg transition-colors duration-200',
        'placeholder:text-fg-subtle',
        'hover:border-fg/20 focus:border-accent focus:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}
