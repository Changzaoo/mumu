import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
import { logout } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { resolveTheme, useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { useScrollContainer } from '@/app/layout/scroll-context';

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);

/**
 * Sticky top bar — transparent at rest, glass once the page scrolls
 * ([data-scrolled]). Back/forward, ⌘K trigger, theme toggle, account menu.
 */
export function TopBar() {
  const navigate = useNavigate();
  const scroller = useScrollContainer();
  const [scrolled, setScrolled] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { user, profile, loading } = useAuthUser();

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

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className={cn(
          'flex h-9 flex-1 items-center gap-2 rounded-full border border-border bg-bg-elevated/60 px-3.5 text-sm text-fg-subtle transition-colors duration-200',
          'hover:border-fg/20 hover:text-fg-muted md:max-w-sm',
        )}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-fg-subtle sm:inline-block">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

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
