import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { AddMusicDialog } from '@/components/media/AddMusicDialog';
import { NotificationBell } from '@/app/layout/NotificationBell';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useDebounce } from '@/hooks/useDebounce';
import { logout } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { resolveTheme, useSettingsStore } from '@/stores/settingsStore';
import { useScrollContainer } from '@/app/layout/scroll-context';

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);

/**
 * Sticky top bar — transparent at rest, glass once the page scrolls
 * ([data-scrolled]). Back/forward, ⌘K trigger, theme toggle, account menu.
 */
export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const scroller = useScrollContainer();
  const [scrolled, setScrolled] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { user, profile, loading } = useAuthUser();

  // ── Inline search (Spotify behaviour): typing here renders the results on
  // /search on the SAME screen — no modal. ⌘K/Ctrl K focuses the field.
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const onSearchPage = location.pathname === '/search';

  // Something else set ?q (voice, recent-search chip) → mirror it here.
  useEffect(() => {
    if (!onSearchPage) return;
    const q = new URLSearchParams(location.search).get('q') ?? '';
    setSearch((prev) => (prev === q ? prev : q));
  }, [location.search, onSearchPage]);

  // Live-update the URL while typing (replace: keeps history clean).
  useEffect(() => {
    if (!onSearchPage) return;
    const current = new URLSearchParams(location.search).get('q') ?? '';
    const next = debouncedSearch.trim();
    if (next === current) return;
    void navigate(next ? `/search?q=${encodeURIComponent(next)}` : '/search', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typing drives this
  }, [debouncedSearch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!scroller) return;
    const onScroll = (): void => setScrolled(scroller.scrollTop > 8);
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller]);

  const resolved = resolveTheme(theme);
  const displayName = profile?.displayName ?? user?.displayName ?? 'Conta';
  const canModerate = profile?.role === 'ADMIN' || profile?.role === 'MODERATOR';

  return (
    <div
      data-scrolled={scrolled || undefined}
      className={cn(
        'sticky top-0 z-30 -mx-4 flex h-16 items-center gap-2 px-4 transition-colors duration-200 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8',
        'data-scrolled:glass data-scrolled:rounded-none data-scrolled:border-x-0 data-scrolled:border-t-0',
      )}
    >
      <div className="hidden items-center gap-1 md:flex">
        <IconButton aria-label="Voltar" size="sm" onClick={() => void navigate(-1)}>
          <ChevronLeft />
        </IconButton>
        <IconButton aria-label="Avançar" size="sm" onClick={() => void navigate(1)}>
          <ChevronRight />
        </IconButton>
      </div>

      <div className="relative flex h-9 flex-1 items-center md:max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 size-4 text-fg-subtle" />
        <input
          ref={searchRef}
          type="search"
          role="searchbox"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!onSearchPage) void navigate('/search');
          }}
          onFocus={() => {
            if (!onSearchPage) void navigate('/search');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearch('');
          }}
          placeholder="O que você quer ouvir?"
          aria-label="Buscar"
          className={cn(
            'h-9 w-full rounded-full border border-border bg-bg-elevated/60 pl-10 pr-14 text-sm text-fg',
            'placeholder:text-fg-subtle transition-colors duration-200',
            'hover:border-fg/20 focus:border-accent focus:outline-none',
          )}
        />
        <kbd className="pointer-events-none absolute right-3 hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-fg-subtle sm:inline-block">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {user && (
          <IconButton aria-label="Adicionar música" onClick={() => setAddOpen(true)}>
            <Plus />
          </IconButton>
        )}
        <AddMusicDialog open={addOpen} onOpenChange={setAddOpen} />
        <NotificationBell />
        <IconButton
          aria-label={resolved === 'dark' ? 'Tema claro' : 'Tema escuro'}
          onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
        </IconButton>

        {!loading && !user && (
          <Button variant="accent" size="sm" onClick={() => void navigate('/login')}>
            Entrar
          </Button>
        )}

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Menu da conta"
                className="rounded-full transition-transform duration-200 hover:scale-105"
              >
                <Avatar>
                  {(profile?.avatarUrl ?? user.photoURL) && (
                    <AvatarImage src={profile?.avatarUrl ?? user.photoURL ?? undefined} alt="" />
                  )}
                  <AvatarFallback>{displayName.slice(0, 2)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="text-fg">{displayName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {profile && (
                <DropdownMenuItem asChild>
                  <Link to={`/profile/${profile.handle}`}>
                    <User /> Perfil
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings /> Configurações
                </Link>
              </DropdownMenuItem>
              {canModerate && (
                <DropdownMenuItem asChild>
                  <Link to="/admin">
                    <Shield /> Administração
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void logout().then(() => toast('Sessão encerrada'));
                }}
              >
                <LogOut /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
