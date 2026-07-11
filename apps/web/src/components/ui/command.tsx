import type { ComponentProps } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex size-full flex-col overflow-hidden text-fg', className)}
      {...props}
    />
  );
}

export interface CommandDialogProps extends ComponentProps<typeof Dialog> {
  title?: string;
}

/** ⌘K palette host — glass panel, top-aligned like Raycast. */
export function CommandDialog({
  title = 'Paleta de comandos',
  children,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[20%] max-w-xl translate-y-0 overflow-hidden p-0 [&>button[aria-label='Fechar']]:hidden"
      >
        <span className="sr-only">{title}</span>
        <Command
          loop
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-fg/8 px-4">
      <Search className="size-4 shrink-0 text-fg-subtle" />
      <CommandPrimitive.Input
        className={cn(
          'h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle',
          className,
        )}
        {...props}
      />
      <kbd className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
        ESC
      </kbd>
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-80 overflow-y-auto overscroll-contain p-2', className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-sm text-fg-muted" {...props} />;
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn('overflow-hidden', className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-3 rounded-sm px-3 py-2.5 text-sm text-fg outline-none',
        'data-[selected=true]:bg-fg/8 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator className={cn('-mx-2 my-2 h-px bg-fg/8', className)} {...props} />
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto font-mono text-[11px] tracking-wide text-fg-subtle', className)}
      {...props}
    />
  );
}
