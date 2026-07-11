import type { ComponentProps } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

/**
 * Thin 4px slider (DESIGN §8): thumb appears on hover/focus,
 * range turns accent on hover. Supports vertical orientation (EQ).
 */
export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'group/slider relative flex w-full touch-none select-none items-center',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-4 data-[orientation=vertical]:flex-col data-[orientation=vertical]:justify-center',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative h-1 w-full grow overflow-hidden rounded-full bg-fg/15',
          'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1',
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            'absolute h-full rounded-full bg-fg transition-colors duration-200 group-hover/slider:bg-accent',
            'data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-full',
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-3 rounded-full bg-fg opacity-0 shadow-sm transition-opacity duration-200',
          'group-hover/slider:opacity-100 focus-visible:opacity-100 data-[state=active]:opacity-100',
        )}
      />
    </SliderPrimitive.Root>
  );
}
