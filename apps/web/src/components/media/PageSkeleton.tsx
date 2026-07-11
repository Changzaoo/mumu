import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface PageSkeletonProps {
  variant?: 'home' | 'list' | 'detail';
  className?: string;
}

function CardRowSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 ml-3 h-6 w-44" />
      <div className="no-scrollbar flex gap-1 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-40 shrink-0 p-3 md:w-44">
            <Skeleton className="aspect-square rounded-lg" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackRowsSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="size-10 rounded-sm" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 max-w-56" />
            <Skeleton className="h-3 max-w-36" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Skeletons matching the final layout — never spinners for content (DESIGN §9). */
export function PageSkeleton({ variant = 'home', className }: PageSkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite" className={cn('space-y-8 py-4', className)}>
      {variant === 'home' && (
        <>
          <Skeleton className="ml-3 h-9 w-64" />
          <CardRowSkeleton />
          <CardRowSkeleton />
        </>
      )}
      {variant === 'list' && (
        <>
          <Skeleton className="ml-2 h-9 w-56" />
          <TrackRowsSkeleton count={12} />
        </>
      )}
      {variant === 'detail' && (
        <>
          <div className="flex flex-col items-center gap-6 pt-4 md:flex-row md:items-end">
            <Skeleton className="size-44 rounded-xl md:size-[232px]" />
            <div className="flex flex-col items-center gap-3 md:items-start">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-11 w-72" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <TrackRowsSkeleton count={8} />
        </>
      )}
    </div>
  );
}
