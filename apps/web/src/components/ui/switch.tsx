import type { ComponentProps } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-fg/15 transition-colors duration-200',
        'data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
