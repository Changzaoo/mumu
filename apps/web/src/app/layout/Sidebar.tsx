import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  Compass,
  Download,
  HardDriveDownload,
  Heart,
  History,
  Home,
  Library,
  ListMusic,
  PanelLeft,
  Podcast,
  Radio,
  Search,
  Share2,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AurialLogo, AurialMark } from '@/components/brand/AurialMark';
import { IconButton } from '@/components/ui/icon-button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePlaylistsNav } from '@/features/library/api';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/uiStore';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

const MAIN_NAV: NavEntry[] = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/search', label: 'Buscar', icon: Search },
  { to: '/discover', label: 'Descobrir', icon: Compass },
];

const DEVICE_NAV: NavEntry[] = [
  { to: '/dispositivo', label: 'No dispositivo', icon: HardDriveDownload },
  { to: '/compartilhar', label: 'Compartilhar', icon: Share2 },
];

const LIBRARY_NAV: NavEntry[] = [
  { to: '/library', label: 'Biblioteca', icon: Library },
  { to: '/liked', label: 'Curtidas', icon: Heart },
  { to: '/history', label: 'Histórico', icon: History },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/uploads', label: 'Uploads', icon: Upload },
  { to: '/radios', label: 'Rádios', icon: Radio },
  { to: '/podcasts', label: 'Podcasts', icon: Podcast },
];

function NavItem({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  const { to, label, icon: Icon } = entry;
  const link = (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-200',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-accent/12 text-accent' : 'text-fg-muted hover:bg-fg/5 hover:text-fg',
        )
      }
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-3 my-2 h-px bg-border" />;
  return (
    <p className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
      {children}
    </p>
  );
}

/**
 * Desktop sidebar (DESIGN §7): 280px, collapsible to 72px icons (persisted),
 * nav sections + user playlists.
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { playlists, isLoading } = usePlaylistsNav();

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-bg-elevated md:flex',
        collapsed ? 'w-[72px]' : 'w-[280px]',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center px-4',
          collapsed ? 'justify-center px-0' : 'justify-between',
        )}
      >
        {collapsed ? <AurialMark /> : <AurialLogo />}
        {!collapsed && (
          <IconButton aria-label="Recolher menu" size="sm" onClick={toggleSidebar}>
            <PanelLeft />
          </IconButton>
        )}
      </div>

      <nav aria-label="Menu principal" className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="space-y-0.5">
          {MAIN_NAV.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>

        <SectionLabel collapsed={collapsed}>Meu espaço</SectionLabel>
        <div className="space-y-0.5">
          {DEVICE_NAV.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>

        <SectionLabel collapsed={collapsed}>Biblioteca</SectionLabel>
        <div className="space-y-0.5">
          {LIBRARY_NAV.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>

        {!collapsed && (
          <>
            <SectionLabel collapsed={false}>Playlists</SectionLabel>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-0.5 pr-2">
                {isLoading &&
                  Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="flex h-9 items-center gap-3 px-3">
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-3 flex-1" />
                    </div>
                  ))}
                {playlists.map((playlist) => (
                  <NavLink
                    key={playlist.id}
                    to={`/playlist/${playlist.id}`}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-200',
                        isActive
                          ? 'bg-accent/12 text-accent'
                          : 'text-fg-muted hover:bg-fg/5 hover:text-fg',
                      )
                    }
                  >
                    <ListMusic className="size-4 shrink-0" />
                    <span className="truncate">{playlist.title}</span>
                  </NavLink>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        {collapsed && (
          <div className="mt-auto flex justify-center pt-3">
            <IconButton aria-label="Expandir menu" size="sm" onClick={toggleSidebar}>
              <PanelLeft />
            </IconButton>
          </div>
        )}
      </nav>
    </aside>
  );
}
