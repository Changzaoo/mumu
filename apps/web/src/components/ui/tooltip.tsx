import type { ComponentProps } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

/** Mount once near the app root with delayDuration 400 (DESIGN §8). */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'glass z-50 rounded-md px-2.5 py-1.5 text-xs font-medium text-fg shadow-lg animate-scale-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
