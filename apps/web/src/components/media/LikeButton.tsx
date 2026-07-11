import type { ComponentProps } from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LikeButtonProps extends Omit<ComponentProps<'button'>, 'onToggle' | 'children'> {
  liked: boolean;
  /** Server mutation lives in the features layer — this stays controlled. */
  onToggle?: (liked: boolean) => void;
  size?: 'sm' | 'md';
}

/** Heart with a spring pop on like. Controlled: pass `liked` + `onToggle`. */
export function LikeButton({ liked, onToggle, size = 'sm', className, ...props }: LikeButtonProps) {
  return (
    <button
      type="button"
      aria-label={liked ? 'Remover das curtidas' : 'Curtir'}
      aria-pressed={liked}
      onClick={() => onToggle?.(!liked)}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition-colors duration-200',
        size === 'sm' ? 'size-8' : 'size-9',
        liked ? 'text-accent' : 'text-fg-muted hover:text-fg',
        className,
      )}
      {...props}
    >
      <motion.span
        key={liked ? 'liked' : 'unliked'}
        initial={liked ? { scale: 0.4 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        className="grid place-items-center"
      >
        <Heart className={cn(size === 'sm' ? 'size-4' : 'size-[18px]', liked && 'fill-current')} />
      </motion.span>
    </button>
  );
}
