import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-fg transition-colors duration-200',
        'placeholder:text-fg-subtle',
        'hover:border-fg/20 focus:border-accent focus:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
