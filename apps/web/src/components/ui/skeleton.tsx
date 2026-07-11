import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Shimmering placeholder — always match the final layout (DESIGN §9). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}
