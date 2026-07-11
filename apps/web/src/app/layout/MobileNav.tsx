import { NavLink } from 'react-router';
import { Home, Library, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/search', label: 'Buscar', icon: Search },
  { to: '/library', label: 'Biblioteca', icon: Library },
];

/** Bottom tabs (<768px), glass, safe-area aware (DESIGN §7). */
export function MobileNav() {
  return (
    <nav
      aria-label="Navegação"
      className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-200',
              isActive ? 'text-accent' : 'text-fg-muted',
            )
          }
        >
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
