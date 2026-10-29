/**
 * Mobile bottom tabs (<768px) — Spotify-style: three destinations + "Mais",
 * floating over a soft gradient (no hard bar), iOS-feel Ionicons with the
 * FILLED variant when active. Safe-area aware; the MiniPlayer floats above.
 */
import { useState, useSyncExternalStore } from 'react';
import { NavLink } from 'react-router';
import type { IconType } from 'react-icons';
import {
  IoCompassOutline,
  IoDownloadOutline,
  IoEllipsisHorizontal,
  IoHeart,
  IoHome,
  IoHomeOutline,
  IoLibrary,
  IoLibraryOutline,
  IoMicOutline,
  IoMusicalNotesOutline,
  IoPeopleOutline,
  IoRadioOutline,
  IoSearch,
  IoSearchOutline,
  IoSettingsOutline,
  IoShareSocialOutline,
  IoShieldCheckmarkOutline,
  IoTimeOutline,
} from 'react-icons/io5';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsAuthorized } from '@/lib/auth/roles';
import { capaNoTamanho } from '@/lib/capaNoTamanho';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { cn } from '@/lib/utils';
import { useVoltarAoTopo } from '@/app/layout/useVoltarAoTopo';

interface Tab {
  to: string;
  label: string;
  icon: IconType;
  iconActive: IconType;
}

const TABS: Tab[] = [
  { to: '/', label: 'Início', icon: IoHomeOutline, iconActive: IoHome },
  { to: '/search', label: 'Buscar', icon: IoSearchOutline, iconActive: IoSearch },
  { to: '/library', label: 'Biblioteca', icon: IoLibraryOutline, iconActive: IoLibrary },
];

interface MenuGroup {
  heading: string;
  items: Array<{ to: string; label: string; icon: IconType }>;
}

/**
 * Tudo o que não está na barra de baixo — no menu "Mais". Pedido do dono
 * (29/10/2026): mais coisas aqui, começando pelas playlists da pessoa (ver
 * `MinhasPlaylists`, que vem antes destes grupos). "Adicionar músicas" saiu: o
 * acervo vem do YouTube. A telemetria é uma aba da Administração.
 */
const MENU: MenuGroup[] = [
  {
    heading: 'Descobrir',
    items: [
      { to: '/discover', label: 'Descobrir', icon: IoCompassOutline },
      { to: '/radios', label: 'Rádios', icon: IoRadioOutline },
      { to: '/podcasts', label: 'Podcasts', icon: IoMicOutline },
      { to: '/artistas', label: 'Artistas', icon: IoPeopleOutline },
    ],
  },
  {
    heading: 'Biblioteca',
    items: [
      // GRAVADORA NÃO É DESTINO, é atalho. A lista de selos não é algo que se
      // navega ("quero ver minhas gravadoras"); ela só faz sentido quando você
      // já está olhando um artista ou uma faixa e quer saber quem lançou. A
      // página do selo continua existindo — chega-se a ela clicando no nome
      // onde ele aparece, não por uma aba na barra. (Curtidas está em "Minhas
      // playlists", lá em cima.)
      { to: '/history', label: 'Histórico', icon: IoTimeOutline },
      { to: '/dispositivo', label: 'Baixadas', icon: IoDownloadOutline },
      { to: '/compartilhar', label: 'Compartilhar', icon: IoShareSocialOutline },
    ],
  },
  {
    heading: 'Conta',
    items: [
      { to: '/settings', label: 'Configurações', icon: IoSettingsOutline },
      { to: '/admin', label: 'Administração', icon: IoShieldCheckmarkOutline },
    ],
  },
];

/** Entradas restritas a quem tem acesso (as rotas são gateadas). */
const ADMIN_ONLY = new Set(['/admin', '/dispositivo']);

/** Quantas playlists o menu mostra antes do "Ver todas". */
const PLAYLISTS_NO_MENU = 6;

/** As playlists da pessoa, com capa, no topo do menu "Mais". */
function MinhasPlaylists({ fechar }: { fechar: () => void }) {
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);
  const curtidas = useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);
  const capaDe = (p: localPlaylists.LocalPlaylist): string | null => {
    if (p.coverUrl) return p.coverUrl;
    for (const id of p.trackIds) {
      const capa = localLibrary.entryFor(id)?.track.coverUrl;
      if (capa) return capa;
    }
    return null;
  };
  const item =
    'flex items-center gap-3 rounded-xl border border-border p-2 text-sm font-medium transition-colors duration-200';
  return (
    <div>
      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
        Minhas playlists
      </p>
      <div className="grid grid-cols-2 gap-2">
        <NavLink
          to="/liked"
          onClick={fechar}
          className={({ isActive }) =>
            cn(item, isActive ? 'border-accent/40 bg-accent/12' : 'hover:bg-fg/5')
          }
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
            <IoHeart className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-fg">Curtidas</span>
            <span className="block truncate text-[11px] text-fg-muted">
              {curtidas} {curtidas === 1 ? 'música' : 'músicas'}
            </span>
          </span>
        </NavLink>
        {playlists.slice(0, PLAYLISTS_NO_MENU).map((p) => {
          const capa = capaDe(p);
          return (
            <NavLink
              key={p.id}
              onClick={fechar}
              to={`/playlist/${p.id}`}
              className={({ isActive }) =>
                cn(item, isActive ? 'border-accent/40 bg-accent/12' : 'hover:bg-fg/5')
              }
            >
              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-fg/8 text-fg-subtle">
                {capa ? (
                  <img
                    src={capaNoTamanho(capa, 'linha') ?? undefined}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <IoMusicalNotesOutline className="size-5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-fg">{p.title}</span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {p.trackIds.length} {p.trackIds.length === 1 ? 'música' : 'músicas'}
                </span>
              </span>
            </NavLink>
          );
        })}
        <NavLink
          to="/library"
          onClick={fechar}
          className={cn(item, 'text-fg-muted hover:bg-fg/5 hover:text-fg')}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-fg/8">
            <IoLibraryOutline className="size-5" />
          </span>
          <span className="truncate">
            {playlists.length > PLAYLISTS_NO_MENU
              ? `Ver todas (${playlists.length})`
              : 'Biblioteca'}
          </span>
        </NavLink>
      </div>
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const authorized = useIsAuthorized();
  // "Início" estando na Início: volta ao topo em vez de não fazer nada.
  const voltarAoTopo = useVoltarAoTopo();
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
        data-giro="barra"
        aria-label="Navegação"
        // SÓLIDO E SEM FOLGA NO TOPO. O gradiente e o `pt-3` existiam para o
        // conteúdo sumir suavemente por baixo das abas — mas com o mini player
        // encostado em cima delas, esse degradê passou a ser o vão por onde a
        // página aparecia entre as duas peças. Fundo chapado, altura exata:
        // as abas e o player viram um bloco só.
        className="glass-strong fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {/* 64px-tall targets with 28px glyphs — comfortably above Apple's 44pt
            minimum touch size; labels readable at arm's length. */}
        <div className="flex h-16 items-stretch justify-around">
          {TABS.map(({ to, label, icon: Icon, iconActive: IconActive }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={(event) => voltarAoTopo(event, to)}
              className="flex-1"
            >
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
            <MinhasPlaylists fechar={() => setOpen(false)} />
            {menu.map((group) => (
              <div key={group.heading}>
                <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  {group.heading}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={`${group.heading}:${to}`}
                      onClick={() => setOpen(false)}
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
