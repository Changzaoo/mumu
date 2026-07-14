/**
 * Mobile bottom tabs (<768px) — Spotify-style: three destinations + "Mais",
 * floating over a soft gradient (no hard bar), iOS-feel Ionicons with the
 * FILLED variant when active. Safe-area aware; the MiniPlayer floats above.
 */
import { useState } from 'react';
import { NavLink } from 'react-router';
import type { IconType } from 'react-icons';
import {
  IoCompassOutline,
  IoEllipsisHorizontal,
  IoHeartOutline,
  IoHome,
  IoHomeOutline,
  IoLibrary,
  IoLibraryOutline,
  IoPeopleOutline,
  IoPhonePortraitOutline,
  IoPulseOutline,
  IoSearch,
  IoSearchOutline,
  IoTimeOutline,
} from 'react-icons/io5';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsAuthorized } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

interface Tab {
  to: string;
  label: string;
  icon: IconType;
  iconActive: IconType;
}

const TABS: Tab[] = [
  { to: '/', label: 'Início', icon: IoHomeOutline, iconActive: IoHome },
  { to: '/search', label: 'Buscar', icon: IoSearchOutline, iconActive: IoSearch },
  { to: '/library', label: 'Sua Biblioteca', icon: IoLibraryOutline, iconActive: IoLibrary },
];

interface MenuGroup {
  heading: string;
  items: Array<{ to: string; label: string; icon: IconType }>;
}

/** Everything not on the bottom bar — reachable from the "Mais" sheet. */
const MENU: MenuGroup[] = [
  {
    heading: 'Descobrir',
    items: [{ to: '/discover', label: 'Descobrir', icon: IoCompassOutline }],
  },
  {
    heading: 'Meu espaço',
    items: [
      { to: '/dispositivo', label: 'No dispositivo', icon: IoPhonePortraitOutline },
      { to: '/telemetria', label: 'Telemetria', icon: IoPulseOutline },
    ],
  },
  {
    heading: 'Biblioteca',
    items: [
      { to: '/artistas', label: 'Artistas', icon: IoPeopleOutline },
      { to: '/liked', label: 'Curtidas', icon: IoHeartOutline },
      { to: '/history', label: 'Histórico', icon: IoTimeOutline },
    ],
  },
];

/** Device/management entries restricted to authorized users. */
const ADMIN_ONLY = new Set(['/dispositivo', '/telemetria']);

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const authorized = useIsAuthorized();
  const menu = authorized
    ? MENU
    : MENU.map((g) => ({ ...g, items: g.items.filter((i) => !ADMIN_ONLY.has(i.to)) })).filter(
        (g) => g.items.length > 0,
      );

  return (
    <>
      {/* Solid bar (Spotify-like): only a hair of fade at the very top edge —
          content scrolls "under" it without the tabs ever looking see-through. */}
      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-40 bg-linear-to-t from-bg from-85% to-bg/0 pb-[env(safe-area-inset-bottom)] pt-3 md:hidden"
      >
        {/* 64px-tall targets with 28px glyphs — comfortably above Apple's 44pt
            minimum touch size; labels readable at arm's length. */}
        <div className="flex h-16 items-stretch justify-around">
          {TABS.map(({ to, label, icon: Icon, iconActive: IconActive }) => (
            <NavLink key={to} to={to} end={to === '/'} className="flex-1">
              {({ isActive }) => (
                <span
                  className={cn(
                    'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-200',
                    isActive ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  {isActive ? <IconActive className="size-7" /> : <Icon className="size-7" />}
                  {label}
                </span>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            aria-label="Mais"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-muted transition-colors duration-200"
          >
            <IoEllipsisHorizontal className="size-7" />
            Mais
          </button>
        </div>
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
                        <Icon className="size-4.5 shrink-0" />
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
