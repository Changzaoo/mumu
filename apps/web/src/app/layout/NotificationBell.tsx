import {
  Bell,
  CloudDownload,
  Download,
  Info,
  RefreshCw,
  Share2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';
import { useNotifications, type NotificationType } from '@/stores/notificationsStore';

const ICONS: Record<NotificationType, LucideIcon> = {
  download: Download,
  import: CloudDownload,
  shared: Share2,
  update: RefreshCw,
  sync: RefreshCw,
  info: Info,
  error: TriangleAlert,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Top-bar notification center: bell + unread dot + dropdown feed. */
export function NotificationBell() {
  const items = useNotifications((s) => s.items);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const remove = useNotifications((s) => s.remove);
  const clear = useNotifications((s) => s.clear);
  const unread = items.filter((i) => !i.read).length;

  return (
    <DropdownMenu onOpenChange={(open) => open && unread > 0 && markAllRead()}>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={unread > 0 ? `Notificações (${unread})` : 'Notificações'}>
          <span className="relative">
            <Bell />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-accent-fg">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-fg">Notificações</p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => clear()}
              className="text-[12px] font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Limpar
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="grid place-items-center gap-2 px-4 py-10 text-center">
            <Bell className="size-6 text-fg-subtle" />
            <p className="text-[13px] text-fg-muted">Nada por aqui ainda.</p>
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {items.map((item) => {
              const Icon = ICONS[item.type];
              return (
                <li
                  key={item.id}
                  className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-fg/5"
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                      item.type === 'error'
                        ? 'bg-danger/12 text-danger'
                        : 'bg-accent/12 text-accent',
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{item.title}</p>
                    {item.body && (
                      <p className="line-clamp-2 text-[12px] text-fg-muted">{item.body}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-fg-subtle">{timeAgo(item.at)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remover"
                    onClick={() => remove(item.id)}
                    className="text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
