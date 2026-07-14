/**
 * Desktop sidebar — Spotify-style: main nav on top, then "Sua Biblioteca" with
 * filter pills (Playlists / Artistas / Álbuns) and a rich item list showing the
 * REAL artwork of each entry (round thumbs for artists), all from local data.
 * Collapsible to a 72px icon rail (persisted).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { IconType } from 'react-icons';
import {
  IoCompass,
  IoCompassOutline,
  IoDiscOutline,
  IoHeartOutline,
  IoHome,
  IoHomeOutline,
  IoLibraryOutline,
  IoMusicalNotesOutline,
  IoPeopleOutline,
  IoPhonePortraitOutline,
  IoPulseOutline,
  IoSearch,
  IoSearchOutline,
  IoTimeOutline,
} from 'react-icons/io5';
import { PanelLeft } from 'lucide-react';
import { AurialLogo, AurialMark } from '@/components/brand/AurialMark';
import { IconButton } from '@/components/ui/icon-button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsAuthorized } from '@/lib/auth/roles';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/uiStore';

interface NavEntry {
  to: string;
  label: string;
  icon: IconType;
  /** Filled variant shown when the route is active (iOS/Spotify feel). */
  iconActive?: IconType;
}

const MAIN_NAV: NavEntry[] = [
  { to: '/', label: 'Início', icon: IoHomeOutline, iconActive: IoHome },
  { to: '/search', label: 'Buscar', icon: IoSearchOutline, iconActive: IoSearch },
  { to: '/discover', label: 'Descobrir', icon: IoCompassOutline, iconActive: IoCompass },
];

/** Device/management entries restricted to authorized users. */
const ADMIN_ONLY = new Set(['/dispositivo', '/telemetria']);

const TOOLS_NAV: NavEntry[] = [
  { to: '/dispositivo', label: 'No dispositivo', icon: IoPhonePortraitOutline },
  { to: '/telemetria', label: 'Telemetria', icon: IoPulseOutline },
];

type LibraryFilter = 'playlists' | 'artistas' | 'albuns';

const FILTERS: Array<{ key: LibraryFilter; label: string }> = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'artistas', label: 'Artistas' },
  { key: 'albuns', label: 'Álbuns' },
];

function NavItem({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  const { to, label, icon: Icon, iconActive: IconActive } = entry;
  const link = (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-200',
          collapsed && 'justify-center px-0',
          isActive ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && IconActive ? (
            <IconActive className="size-5 shrink-0" />
          ) : (
            <Icon className="size-5 shrink-0" />
          )}
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
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

/** One rich library row: artwork thumb + title + subtitle (Spotify style). */
function LibraryItem({
  to,
  title,
  subtitle,
  imageUrl,
  icon: Icon,
  round = false,
}: {
  to: string;
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  icon: IconType;
  round?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg p-2 transition-colors duration-200',
          isActive ? 'bg-fg/10' : 'hover:bg-fg/5',
        )
      }
    >
      <span
        className={cn(
          'grid size-12 shrink-0 place-items-center overflow-hidden bg-fg/8 text-fg-subtle',
          round ? 'rounded-full' : 'rounded-md',
        )}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Icon className="size-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-fg">{title}</span>
        <span className="line-clamp-1 text-[12px] text-fg-muted">{subtitle}</span>
      </span>
    </NavLink>
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

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const authorized = useIsAuthorized();
  const [filter, setFilter] = useState<LibraryFilter>('playlists');

  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => []);
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);
  const likedCount = useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);
  const artists = localLibrary.artists();
  const albums = localLibrary.albumGroups();

  const toolsNav = authorized ? TOOLS_NAV : TOOLS_NAV.filter((e) => !ADMIN_ONLY.has(e.to));

  const playlistCover = (trackIds: string[]): string | null => {
    for (const id of trackIds) {
      const cover = entries.find((e) => e.track.id === id)?.track.coverUrl;
      if (cover) return cover;
    }
    return null;
  };

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-bg-elevated md:flex',
        collapsed ? 'w-18' : 'w-75',
      )}
    >
      {collapsed ? (
        // Collapsed rail header: mark + expand toggle stacked and centered —
        // everything on the rail shares one visual axis.
        <div className="flex flex-col items-center gap-1.5 py-4">
          <AurialMark />
          <IconButton aria-label="Expandir menu" size="sm" onClick={toggleSidebar}>
            <PanelLeft />
          </IconButton>
        </div>
      ) : (
        <div className="flex h-16 items-center justify-between px-4">
          <AurialLogo />
          <IconButton aria-label="Recolher menu" size="sm" onClick={toggleSidebar}>
            <PanelLeft />
          </IconButton>
        </div>
      )}

      <nav aria-label="Menu principal" className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="space-y-0.5">
          {MAIN_NAV.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>

        {/* ── Sua Biblioteca (Spotify-style) ── */}
        {collapsed ? (
          <>
            <SectionLabel collapsed>Biblioteca</SectionLabel>
            <div className="space-y-0.5">
              {[
                { to: '/library', label: 'Sua Biblioteca', icon: IoLibraryOutline },
                { to: '/liked', label: 'Curtidas', icon: IoHeartOutline },
                { to: '/history', label: 'Histórico', icon: IoTimeOutline },
              ].map((entry) => (
                <NavItem key={entry.to} entry={entry} collapsed />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between px-3">
              <NavLink
                to="/library"
                className="flex items-center gap-2 text-sm font-bold text-fg-muted transition-colors hover:text-fg"
              >
                <IoLibraryOutline className="size-5" />
                Sua Biblioteca
              </NavLink>
              <NavLink
                to="/history"
                aria-label="Histórico"
                className="text-fg-subtle transition-colors hover:text-fg"
              >
                <IoTimeOutline className="size-4" />
              </NavLink>
            </div>

            <div className="mt-3 flex gap-1.5 px-1">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-200',
                    filter === key ? 'bg-fg text-bg' : 'bg-fg/8 text-fg hover:bg-fg/14',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <ScrollArea className="mt-2 min-h-0 flex-1">
              <div className="space-y-0.5 pr-2">
                <LibraryItem
                  to="/liked"
                  title="Músicas Curtidas"
                  subtitle={`Playlist • ${likedCount} ${likedCount === 1 ? 'música' : 'músicas'}`}
                  icon={IoHeartOutline}
                />
                {filter === 'playlists' &&
                  playlists.map((playlist) => (
                    <LibraryItem
                      key={playlist.id}
                      to={`/playlist/${playlist.id}`}
                      title={playlist.title}
                      subtitle={`Playlist • ${playlist.trackIds.length} faixas`}
                      imageUrl={playlistCover(playlist.trackIds)}
                      icon={IoMusicalNotesOutline}
                    />
                  ))}
                {filter === 'artistas' &&
                  artists.map((artist) => (
                    <LibraryItem
                      key={artist.name}
                      to={`/artista/${encodeURIComponent(artist.name)}`}
                      title={artist.name}
                      subtitle="Artista"
                      imageUrl={artist.coverUrl}
                      icon={IoPeopleOutline}
                      round
                    />
                  ))}
                {filter === 'albuns' &&
                  albums.map((album) => (
                    <LibraryItem
                      key={album.key}
                      to={`/disco/${encodeURIComponent(album.key)}`}
                      title={album.title}
                      subtitle={`Álbum • ${album.artist}`}
                      imageUrl={album.coverUrl}
                      icon={IoDiscOutline}
                    />
                  ))}
              </div>
            </ScrollArea>
          </>
        )}

        <SectionLabel collapsed={collapsed}>Ferramentas</SectionLabel>
        <div className="space-y-0.5">
          {toolsNav.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>
      </nav>
    </aside>
  );
}
