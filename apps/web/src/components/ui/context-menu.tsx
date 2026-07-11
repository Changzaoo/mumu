import type { ComponentProps } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '@/lib/utils';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'glass z-50 min-w-44 overflow-hidden rounded-lg p-1 shadow-lg animate-scale-in',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-fg outline-none transition-colors',
        'focus:bg-fg/8 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-fg/8', className)}
      {...props}
    />
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn('px-2.5 py-1.5 text-xs font-medium text-fg-subtle', className)}
      {...props}
    />
  );
}
