import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Compass,
  Download,
  Heart,
  History,
  Home,
  Library,
  Moon,
  Pause,
  Play,
  Podcast,
  Radio,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipForward,
  Sun,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { usePlayerStore } from '@/stores/playerStore';
import { resolveTheme, useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/search', label: 'Buscar', icon: Search },
  { to: '/discover', label: 'Descobrir', icon: Compass },
  { to: '/library', label: 'Biblioteca', icon: Library },
  { to: '/liked', label: 'Curtidas', icon: Heart },
  { to: '/history', label: 'Histórico', icon: History },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/uploads', label: 'Uploads', icon: Upload },
  { to: '/radios', label: 'Rádios', icon: Radio },
  { to: '/podcasts', label: 'Podcasts', icon: Podcast },
  { to: '/settings', label: 'Configurações', icon: Settings },
];

/** ⌘K palette: navigation, free-text search and quick player actions. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const run = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Buscar ou ir para…"
        aria-label="Buscar ou ir para"
      />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>

        {query.trim().length > 0 && (
          <CommandGroup heading="Busca">
            <CommandItem
              value={`buscar ${query}`}
              onSelect={() =>
                run(() => void navigate(`/search?q=${encodeURIComponent(query.trim())}`))
              }
            >
              <Search /> Buscar por “{query.trim()}”<CommandShortcut>Enter</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Navegação">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} onSelect={() => run(() => void navigate(to))}>
              <Icon /> {label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Reprodução">
          <CommandItem
            disabled={!hasTrack}
            onSelect={() => run(() => usePlayerStore.getState().toggle())}
          >
            {isPlaying ? <Pause /> : <Play />} {isPlaying ? 'Pausar' : 'Tocar'}
            <CommandShortcut>Espaço</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasTrack}
            onSelect={() => run(() => usePlayerStore.getState().next())}
          >
            <SkipForward /> Próxima faixa
          </CommandItem>
          <CommandItem onSelect={() => run(() => usePlayerStore.getState().toggleShuffle())}>
            <Shuffle /> Alternar aleatório
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => usePlayerStore.getState().cycleRepeat())}>
            <Repeat /> Alternar repetição
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Aparência">
          <CommandItem
            onSelect={() => run(() => setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark'))}
          >
            {resolveTheme(theme) === 'dark' ? <Sun /> : <Moon />} Alternar tema
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
