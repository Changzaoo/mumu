import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const iconButtonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center rounded-full transition-[background-color,color,opacity] duration-200 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'text-fg-muted hover:bg-fg/8 hover:text-fg',
        solid: 'bg-bg-overlay text-fg hover:bg-fg/10',
        accent: 'bg-accent text-accent-fg hover:bg-accent/90',
      },
      size: {
        sm: 'size-8 [&_svg]:size-4',
        md: 'size-9 [&_svg]:size-[18px]',
        lg: 'size-10 [&_svg]:size-5',
      },
      active: {
        // No tema escuro o destaque é branco e o ícone apagado é cinza-claro: sobre
        // a capa do player os dois ficavam iguais (repetir ligado sem ninguém ver).
        // O ponto embaixo diz "ligado" sem depender da cor.
        true: 'relative text-accent hover:text-accent after:absolute after:bottom-0 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-current after:content-[""]',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
      active: false,
    },
  },
);

export interface IconButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof iconButtonVariants> {
  /** Icon-only buttons must always announce themselves. */
  'aria-label': string;
}

export function IconButton({
  className,
  variant,
  size,
  active,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(iconButtonVariants({ variant, size, active }), className)}
      {...props}
    />
  );
}
