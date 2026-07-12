import { useState } from 'react';
import { NavLink } from 'react-router';
import {
  Compass,
  Download,
  HardDriveDownload,
  Heart,
  History,
  Home,
  Library,
  type LucideIcon,
  Menu,
  Search,
  Share2,
  Upload,
} from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsAuthorized } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

const TABS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/search', label: 'Buscar', icon: Search },
  { to: '/library', label: 'Biblioteca', icon: Library },
];

interface MenuGroup {
  heading: string;
  items: Array<{ to: string; label: string; icon: LucideIcon }>;
}

/** Everything not on the bottom bar — reachable from the "Mais" sheet. */
const MENU: MenuGroup[] = [
  {
    heading: 'Descobrir',
    items: [
      { to: '/', label: 'Início', icon: Home },
      { to: '/search', label: 'Buscar', icon: Search },
      { to: '/discover', label: 'Descobrir', icon: Compass },
    ],
  },
  {
    heading: 'Meu espaço',
    items: [
      { to: '/dispositivo', label: 'No dispositivo', icon: HardDriveDownload },
      { to: '/compartilhar', label: 'Compartilhar', icon: Share2 },
    ],
  },
  {
    heading: 'Biblioteca',
    items: [
      { to: '/library', label: 'Biblioteca', icon: Library },
      { to: '/liked', label: 'Curtidas', icon: Heart },
      { to: '/history', label: 'Histórico', icon: History },
      { to: '/downloads', label: 'Downloads', icon: Download },
      { to: '/uploads', label: 'Uploads', icon: Upload },
    ],
  },
];

/** Device/management entries restricted to authorized users. */
const ADMIN_ONLY = new Set(['/dispositivo', '/downloads', '/uploads']);

/** Bottom tabs (<768px), glass, safe-area aware, with a "Mais" sheet (DESIGN §7). */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const authorized = useIsAuthorized();
  const menu = authorized
    ? MENU
    : MENU.map((g) => ({ ...g, items: g.items.filter((i) => !ADMIN_ONLY.has(i.to)) })).filter(
        (g) => g.items.length > 0,
      );

  const tabClass = (isActive: boolean): string =>
    cn(
      'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-200',
      isActive ? 'text-accent' : 'text-fg-muted',
    );

  return (
    <>
      <nav
        aria-label="Navegação"
        className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => tabClass(isActive)}
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-label="Mais"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={tabClass(false)}
        >
          <Menu className="size-5" />
          Mais
        </button>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] gap-4 overflow-y-auto md:hidden">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 pb-2">
            {menu.map((group) => (
              <div key={group.heading}>
                <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  {group.heading}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <SheetClose asChild key={`${group.heading}:${to}`}>
                      <NavLink
                        to={to}
                        end={to === '/'}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-xl border border-border p-3 text-sm font-medium transition-colors duration-200',
                            isActive
                              ? 'border-accent/40 bg-accent/12 text-accent'
                              : 'text-fg hover:bg-fg/5',
                          )
                        }
                      >
                        <Icon className="size-[18px] shrink-0" />
                        <span className="truncate">{label}</span>
                      </NavLink>
                    </SheetClose>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
