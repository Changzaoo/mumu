import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps extends ComponentProps<'div'> {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** One action, per DESIGN §9 (icon + one sentence + one action). */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-16 text-center', className)} {...props}>
      <span className="grid size-14 place-items-center rounded-full bg-fg/5 text-fg-subtle">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="max-w-sm text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
