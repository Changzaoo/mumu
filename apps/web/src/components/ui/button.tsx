import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,opacity] duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-bg-overlay text-fg hover:bg-fg/10',
        accent: 'bg-accent text-accent-fg hover:bg-accent/90',
        ghost: 'text-fg-muted hover:bg-fg/5 hover:text-fg',
        outline: 'border border-border bg-transparent text-fg hover:bg-fg/5',
        destructive: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
