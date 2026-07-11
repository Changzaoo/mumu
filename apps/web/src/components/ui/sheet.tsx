import type { ComponentProps } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva('glass fixed z-50 flex flex-col gap-4 p-6 shadow-lg', {
  variants: {
    side: {
      right:
        'inset-y-0 right-0 h-full w-3/4 max-w-sm data-[state=open]:animate-slide-in-right rounded-l-xl',
      left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm data-[state=open]:animate-slide-in-left rounded-r-xl',
      top: 'inset-x-0 top-0 data-[state=open]:animate-slide-in-down rounded-b-xl',
      bottom: 'inset-x-0 bottom-0 data-[state=open]:animate-slide-in-up rounded-t-xl',
    },
  },
  defaultVariants: { side: 'right' },
});

export interface SheetContentProps
  extends ComponentProps<typeof DialogPrimitive.Content>, VariantProps<typeof sheetVariants> {}

export function SheetContent({ className, children, side, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <DialogPrimitive.Close
          aria-label="Fechar"
          className="absolute right-4 top-4 rounded-full p-1 text-fg-muted transition-colors hover:bg-fg/8 hover:text-fg"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold tracking-tight text-fg', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />
  );
}
