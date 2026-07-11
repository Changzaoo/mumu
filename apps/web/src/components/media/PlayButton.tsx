import type { ComponentProps } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlayButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'size-8 [&_svg]:size-3.5',
  md: 'size-10 [&_svg]:size-4',
  lg: 'size-12 [&_svg]:size-5',
} as const;

/** Accent circle play/pause — transform/opacity-only animations. */
export function PlayButton({ playing = false, size = 'md', className, ...props }: PlayButtonProps) {
  return (
    <button
      type="button"
      aria-label={playing ? 'Pausar' : 'Reproduzir'}
      className={cn(
        'grid shrink-0 select-none place-items-center rounded-full bg-accent text-accent-fg',
        'shadow-[0_8px_24px_hsl(var(--accent)/0.35)] transition-transform duration-200',
        'hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        sizes[size],
        className,
      )}
      {...props}
    >
      {playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
    </button>
  );
}
