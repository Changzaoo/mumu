/**
 * Desktop sidebar — Spotify-style: main nav on top, then "Biblioteca" with
 * filter pills (Playlists / Artistas / Álbuns) and a rich item list showing the
 * REAL artwork of each entry (round thumbs for artists), all from local data.
 * Collapsible to a 72px icon rail (persisted).
 *
 * OS ARTISTAS QUE A PESSOA SEGUE moram aqui como círculos, junto das capas das
 * playlists — no trilho recolhido também, que era só três ícones genéricos e
 * virou a coluna de capas do Spotify. Seguir acontece na ficha do artista
 * (components/media/SeguirArtista); a loja é lib/local/artistasSeguidos.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { IconType } from 'react-icons';
import {
  IoAddCircleOutline,
  IoCompass,
  IoCompassOutline,
  IoDiscOutline,
  IoHeart,
  IoHeartOutline,
  IoHome,
  IoHomeOutline,
  IoLibraryOutline,
  IoMusicalNotesOutline,
  IoPeopleOutline,
  IoPlay,
  IoPulseOutline,
  IoSearch,
  IoSearchOutline,
  IoTimeOutline,
} from 'react-icons/io5';
import { PanelLeft } from 'lucide-react';
import { RadinhoLogo, RadinhoMark } from '@/components/brand/RadinhoMark';
import { IconButton } from '@/components/ui/icon-button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsAuthorized } from '@/lib/auth/roles';
import { useArtistImage } from '@/lib/artistImage';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/uiStore';
import { capaNoTamanho } from '@/lib/capaNoTamanho';
import {
  prepararMelhoresDoArtista,
  tocarMelhoresDoArtista,
} from '@/lib/reco/tocarMelhoresDoArtista';
import { useVoltarAoTopo } from '@/app/layout/useVoltarAoTopo';

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
  { to: '/dispositivo', label: 'Adicionar músicas', icon: IoAddCircleOutline },
  { to: '/telemetria', label: 'Telemetria', icon: IoPulseOutline },
];

type LibraryFilter = 'playlists' | 'artistas' | 'albuns';

/** Snapshot de servidor estável para o `useSyncExternalStore`. */
const SEM_SEGUIDOS: artistasSeguidos.ArtistaSeguido[] = [];

// A gravadora NÃO é destino de navegação — é atalho. Só se chega ao perfil dela
// clicando onde ela aparece (ficha da faixa, ficha do artista), nunca por uma
// aba própria. Ver /gravadora/:nome, que continua existindo.
const FILTERS: Array<{ key: LibraryFilter; label: string }> = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'artistas', label: 'Artistas' },
  { key: 'albuns', label: 'Álbuns' },
];

function NavItem({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  const { to, label, icon: Icon, iconActive: IconActive } = entry;
  // "Início" estando na Início: volta ao topo em vez de não fazer nada.
  const voltarAoTopo = useVoltarAoTopo();
  const link = (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={(event) => voltarAoTopo(event, to)}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-200',
          // Colapsado: quadrado fixo de 40px com o ícone centralizado. Quem
          // centraliza o quadrado no trilho é o CONTAINER (`items-center`), não o
          // link — porque este item é embrulhado num Tooltip, e o wrapper do
          // Tooltip encolhia o `w-full`, jogando o ícone para a esquerda. Deixar
          // o pai centralizar é o mesmo que o header faz, e não depende do que o
          // Tooltip põe em volta.
          collapsed && 'size-10 shrink-0 justify-center px-0',
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
  onPlay,
  onPrepare,
}: {
  to: string;
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  icon: IconType;
  round?: boolean;
  /** Botão de tocar à direita (aparece ao passar o mouse ou focar). */
  onPlay?: () => void;
  /** Adianta o que o play vai precisar (ex.: ranking do artista). */
  onPrepare?: () => void;
}) {
  const link = (
    <NavLink
      to={to}
      onPointerEnter={onPrepare}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg p-2 transition-colors duration-200',
          onPlay && 'pr-12',
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
          <img
            src={capaNoTamanho(imageUrl, 'linha') ?? undefined}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
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
  if (!onPlay) return link;
  // O botão é IRMÃO do link, não filho: botão dentro de <a> é HTML inválido e
  // o clique no play navegaria junto.
  return (
    <div className="group relative">
      {link}
      <button
        type="button"
        aria-label={`Tocar as melhores de ${title}`}
        onClick={onPlay}
        onFocus={onPrepare}
        className={cn(
          'absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-accent text-accent-fg transition-opacity duration-200',
          // Sem mouse (tablet) não há hover: o botão fica sempre à vista.
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <IoPlay className="size-4 translate-x-px" />
      </button>
    </div>
  );
}

/** Um artista seguido: foto de verdade (cache) → capa guardada → capa do acervo. */
function ArtistaSeguidoItem({
  artista,
  capaDoAcervo,
  collapsed,
}: {
  artista: artistasSeguidos.ArtistaSeguido;
  capaDoAcervo: string | null;
  collapsed: boolean;
}) {
  const foto = useArtistImage(artista.nome);
  const imagem = foto ?? artista.capaUrl ?? capaDoAcervo;
  const to = `/artista/${encodeURIComponent(artista.nome)}`;
  if (collapsed) {
    return (
      <RailThumb to={to} label={artista.nome} imageUrl={imagem} icon={IoPeopleOutline} round />
    );
  }
  return (
    <LibraryItem
      to={to}
      title={artista.nome}
      subtitle="Artista • Seguindo"
      imageUrl={imagem}
      icon={IoPeopleOutline}
      round
      onPrepare={() => prepararMelhoresDoArtista(artista.nome)}
      onPlay={() => tocarMelhoresDoArtista(artista.nome)}
    />
  );
}

/**
 * Uma capa no trilho recolhido (48px): quadrada para playlist, redonda para
 * artista — o formato já diz o que é, o nome vem no tooltip.
 */
function RailThumb({
  to,
  label,
  imageUrl,
  icon: Icon,
  round = false,
  tone = 'neutro',
}: {
  to: string;
  label: string;
  imageUrl?: string | null;
  icon: IconType;
  round?: boolean;
  tone?: 'neutro' | 'destaque';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          aria-label={label}
          className={({ isActive }) =>
            cn(
              'grid size-12 shrink-0 place-items-center overflow-hidden transition-[box-shadow,opacity] duration-200 hover:opacity-90',
              round ? 'rounded-full' : 'rounded-md',
              tone === 'destaque' ? 'bg-accent/15 text-accent' : 'bg-fg/8 text-fg-subtle',
              // Ativo: anel no lugar do fundo, que a capa esconderia.
              isActive && 'ring-2 ring-fg/40 ring-offset-2 ring-offset-bg',
            )
          }
        >
          {imageUrl ? (
            <img
              src={capaNoTamanho(imageUrl, 'linha') ?? undefined}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <Icon className="size-5" />
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-auto my-2 h-px w-10 bg-border" />;
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
  // Nenhum filtro = tudo junto (playlists e artistas seguidos), como no
  // Spotify; tocar no filtro ativo de novo volta para o "tudo".
  const [filter, setFilter] = useState<LibraryFilter | null>(null);

  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => []);
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);
  const likedCount = useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);
  const seguidos = useSyncExternalStore(
    artistasSeguidos.subscribe,
    artistasSeguidos.list,
    () => SEM_SEGUIDOS,
  );
  const artists = localLibrary.artists();
  const albums = localLibrary.albumGroups();

  // Capa do acervo por identidade do artista — reserva para quem foi seguido
  // sem capa. `artists()` é memorizado na biblioteca: só refaz quando ela muda.
  const capaDoAcervo = useMemo(() => {
    const mapa = new Map<string, string | null>();
    for (const a of artists) mapa.set(artistasSeguidos.chaveDoArtista(a.name), a.coverUrl);
    return mapa;
  }, [artists]);
  const chavesSeguidas = useMemo(
    () => new Set(seguidos.map((a) => artistasSeguidos.chaveDoArtista(a.nome))),
    [seguidos],
  );
  const capaDe = (nome: string): string | null =>
    capaDoAcervo.get(artistasSeguidos.chaveDoArtista(nome)) ?? null;

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
      data-giro="barra"
      className={cn(
        // Painel próprio dentro da moldura: cantos arredondados e sem a borda
        // direita, que só fazia sentido quando menu e conteúdo eram a mesma
        // folha coladas. A separação agora é a calha entre os painéis.
        'glass hidden shrink-0 flex-col overflow-hidden rounded-xl md:flex',
        // CELULAR DEITADO — a tela tem a largura de um tablet (o menu aparece)
        // e a altura de nada: ~360px para header, oito atalhos, os filtros da
        // biblioteca e as ferramentas. O que não cabia ficava cortado pelo
        // `overflow-hidden`, sem jeito de alcançar: o único trecho rolável era
        // a lista da biblioteca, lá no meio. Em tela baixa o menu INTEIRO passa
        // a rolar — as fatias de altura fixa dão lugar a uma coluna só.
        '[@media(max-height:640px)]:overflow-y-auto [@media(max-height:640px)]:overscroll-contain',
        collapsed ? 'w-18' : 'w-75',
      )}
    >
      {collapsed ? (
        // Trilho colapsado: header e nav usam O MESMO mecanismo — o CONTAINER
        // centraliza (`items-center`) e cada item é um quadrado de 40px
        // (`size-10`). Nada de `w-full` (que o wrapper do Tooltip da nav
        // encolhia) nem `mx-auto`. Assim marca, botão e todos os ícones abaixo
        // caem no mesmo eixo — o centro dos 72px do trilho.
        <div className="flex shrink-0 flex-col items-center gap-0.5 py-3">
          <div className="grid size-10 place-items-center">
            <RadinhoMark className="size-6" />
          </div>
          <button
            type="button"
            aria-label="Expandir menu"
            onClick={toggleSidebar}
            className="grid size-10 place-items-center rounded-lg text-fg-muted transition-colors duration-200 hover:bg-fg/8 hover:text-fg [&_svg]:size-5"
          >
            <PanelLeft />
          </button>
        </div>
      ) : (
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <RadinhoLogo />
          <IconButton aria-label="Recolher menu" size="sm" onClick={toggleSidebar}>
            <PanelLeft />
          </IconButton>
        </div>
      )}

      <nav
        aria-label="Menu principal"
        className={cn(
          'flex min-h-0 flex-1 flex-col pb-3',
          // Em tela baixa quem rola é o `aside`: a nav cresce com o conteúdo
          // em vez de disputar uma altura que não existe.
          '[@media(max-height:640px)]:min-h-max [@media(max-height:640px)]:flex-none',
          collapsed ? 'px-0' : 'px-3',
        )}
      >
        <div className={collapsed ? 'flex flex-col items-center gap-0.5' : 'space-y-0.5'}>
          {MAIN_NAV.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>

        {/* ── Biblioteca (Spotify-style) ── */}
        {collapsed ? (
          <>
            <SectionLabel collapsed>Biblioteca</SectionLabel>
            <div className="flex flex-col items-center gap-0.5">
              {[
                { to: '/library', label: 'Biblioteca', icon: IoLibraryOutline },
                { to: '/history', label: 'Histórico', icon: IoTimeOutline },
              ].map((entry) => (
                <NavItem key={entry.to} entry={entry} collapsed />
              ))}
            </div>
            {/* A COLUNA DE CAPAS (Spotify): Curtidas, as playlists e, em
                círculo, os artistas seguidos. Rola sozinha; as ferramentas
                ficam presas embaixo. */}
            <ScrollArea className="mt-2 min-h-0 flex-1 [@media(max-height:640px)]:h-auto [@media(max-height:640px)]:flex-none">
              <div className="flex flex-col items-center gap-2 py-1">
                <RailThumb
                  to="/liked"
                  label={`Músicas Curtidas • ${likedCount}`}
                  icon={IoHeart}
                  tone="destaque"
                />
                {playlists.map((playlist) => (
                  <RailThumb
                    key={playlist.id}
                    to={`/playlist/${playlist.id}`}
                    label={playlist.title}
                    imageUrl={playlist.coverUrl ?? playlistCover(playlist.trackIds)}
                    icon={IoMusicalNotesOutline}
                  />
                ))}
                {seguidos.map((artista) => (
                  <ArtistaSeguidoItem
                    key={artista.nome}
                    artista={artista}
                    capaDoAcervo={capaDe(artista.nome)}
                    collapsed
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between px-3">
              <NavLink
                to="/library"
                className="flex items-center gap-2 text-sm font-bold text-fg-muted transition-colors hover:text-fg"
              >
                <IoLibraryOutline className="size-5" />
                Biblioteca
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
                  aria-pressed={filter === key}
                  onClick={() => setFilter((atual) => (atual === key ? null : key))}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-200',
                    filter === key ? 'bg-fg text-bg' : 'bg-fg/8 text-fg hover:bg-fg/14',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* A área rolável da biblioteca só existe quando há altura para
                fatiar; em tela baixa ela vira conteúdo comum e rola junto. */}
            <ScrollArea className="mt-2 min-h-0 flex-1 [@media(max-height:640px)]:h-auto [@media(max-height:640px)]:flex-none">
              <div className="space-y-0.5 pr-2">
                <LibraryItem
                  to="/liked"
                  title="Músicas Curtidas"
                  subtitle={`Playlist • ${likedCount} ${likedCount === 1 ? 'música' : 'músicas'}`}
                  icon={IoHeartOutline}
                />
                {(filter === null || filter === 'playlists') &&
                  playlists.map((playlist) => (
                    <LibraryItem
                      key={playlist.id}
                      to={`/playlist/${playlist.id}`}
                      title={playlist.title}
                      subtitle={`Playlist • ${playlist.trackIds.length} faixas`}
                      imageUrl={playlist.coverUrl ?? playlistCover(playlist.trackIds)}
                      icon={IoMusicalNotesOutline}
                    />
                  ))}
                {(filter === null || filter === 'artistas') &&
                  seguidos.map((artista) => (
                    <ArtistaSeguidoItem
                      key={`seguido:${artista.nome}`}
                      artista={artista}
                      capaDoAcervo={capaDe(artista.nome)}
                      collapsed={false}
                    />
                  ))}
                {/* No filtro "Artistas", depois dos seguidos, o resto do
                    acervo — como sempre foi, para ninguém perder o caminho. */}
                {filter === 'artistas' &&
                  artists
                    .filter(
                      (artist) => !chavesSeguidas.has(artistasSeguidos.chaveDoArtista(artist.name)),
                    )
                    .map((artist) => (
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
        <div className={collapsed ? 'flex flex-col items-center gap-0.5' : 'space-y-0.5'}>
          {toolsNav.map((entry) => (
            <NavItem key={entry.to} entry={entry} collapsed={collapsed} />
          ))}
        </div>
      </nav>
    </aside>
  );
}
