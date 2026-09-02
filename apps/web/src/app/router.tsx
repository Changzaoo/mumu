/**
 * Router — lazy pages at exact paths (ARCHITECTURE §9).
 *
 * Pages live in `src/pages/<Name>Page.tsx` with a DEFAULT export.
 * They are discovered via import.meta.glob so the shell compiles (and ships)
 * before every page exists: a missing page renders a friendly
 * "em construção" placeholder until the file lands — adding the file at the
 * conventional path automatically wires (and code-splits) the route.
 */
import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { PageSkeleton, type PageSkeletonProps } from '@/components/media/PageSkeleton';
import { AppShell } from '@/app/layout/AppShell';
import { AuthorizedRoute } from '@/components/AuthorizedRoute';
import { ErrorBoundary, RouteErrorBoundary } from '@/app/RouteErrorBoundary';
import { RootLayout } from '@/app/RootLayout';

const pageModules = import.meta.glob<{ default: ComponentType }>('/src/pages/*.tsx');

/**
 * Prefixo de rota → nome do arquivo da página, para saber QUAL chunk aquecer
 * quando o dedo encosta num link.
 *
 * A ordem importa: o mais específico primeiro, senão `/album` casaria antes de
 * `/album-apple`. A tabela de rotas de verdade continua sendo a de baixo — esta
 * aqui só serve para adivinhar o chunk antes do clique, e errar aqui não quebra
 * navegação nenhuma, só perde o aquecimento.
 */
const ROTA_POR_PREFIXO: [string, string][] = [
  ['/catalogo/playlist', 'CatalogPlaylistPage'],
  ['/catalogo/artista', 'CatalogArtistPage'],
  ['/album-apple', 'AppleAlbumPage'],
  ['/artista', 'ArtistLocalPage'],
  ['/gravadora', 'LabelLocalPage'],
  ['/gravadoras', 'LabelsPage'],
  ['/genero', 'GenreLocalPage'],
  ['/disco', 'AlbumLocalPage'],
  ['/artistas', 'ArtistsPage'],
  ['/artist', 'ArtistPage'],
  ['/album', 'AlbumPage'],
  ['/playlist', 'PlaylistPage'],
  ['/podcasts', 'PodcastsPage'],
  ['/podcast', 'PodcastPage'],
  ['/profile', 'ProfilePage'],
  ['/telemetria', 'TelemetryPage'],
  ['/dispositivo', 'DevicePage'],
  ['/diagnostico', 'DiagnosticoPage'],
  ['/compartilhar', 'SharePage'],
  ['/downloads', 'DownloadsPage'],
  ['/uploads', 'UploadsPage'],
  ['/discover', 'DiscoverPage'],
  ['/settings', 'SettingsPage'],
  ['/history', 'HistoryPage'],
  ['/library', 'LibraryPage'],
  ['/search', 'SearchPage'],
  ['/radios', 'RadiosPage'],
  ['/liked', 'LikedPage'],
  ['/onboarding', 'OnboardingPage'],
  ['/login', 'LoginPage'],
  ['/admin', 'AdminPage'],
  ['/mix', 'MixPage'],
  ['/s', 'SharedPage'],
  ['/', 'HomePage'],
];

/** Chunks já pedidos — pedir de novo é barato, mas não é de graça. */
const warmed = new Set<string>();

function warm(path: string): void {
  if (warmed.has(path)) return;
  warmed.add(path);
  void pageModules[path]?.().catch(() => {
    warmed.delete(path); // falhou (offline?): pode tentar de novo depois
  });
}

/**
 * Aquece os chunks das páginas para que trocar de página não espere a rede.
 *
 * Antes isto rodava numa única volta de `requestIdleCallback` com folga de 4s.
 * Num app com música tocando, fila importando e biblioteca grande, a ociosidade
 * demora a chegar — o usuário trocava de página antes do aquecimento e pagava o
 * download do chunk na hora, com esqueleto na tela.
 *
 * Agora são duas frentes:
 *  1. POR INTENÇÃO — o ponteiro encostou num link, o dedo tocou: aquece ANTES
 *     do clique. É o que faz a navegação parecer instantânea de verdade, porque
 *     entre encostar e soltar cabe o download inteiro de um chunk.
 *  2. EM SEGUNDO PLANO — o resto, em lotes pequenos, para não disputar banda
 *     com o áudio que está tocando.
 */
if (typeof window !== 'undefined') {
  const pathFor = (href: string): string | null => {
    try {
      const { pathname, origin } = new URL(href, window.location.href);
      if (origin !== window.location.origin) return null;
      const rota = ROTA_POR_PREFIXO.find(
        ([prefixo]) => pathname === prefixo || pathname.startsWith(`${prefixo}/`),
      );
      return rota ? `/src/pages/${rota[1]}.tsx` : null;
    } catch {
      return null;
    }
  };

  const aoEncostar = (event: Event): void => {
    const link = (event.target as HTMLElement | null)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const path = pathFor(link.getAttribute('href') ?? '');
    if (path) warm(path);
  };
  // `pointerenter` não borbulha; `pointerover` sim, e cobre mouse e toque.
  document.addEventListener('pointerover', aoEncostar, { passive: true });
  document.addEventListener('focusin', aoEncostar, { passive: true });

  // Aquecimento de fundo, POR OCIOSIDADE.
  //
  // Antes era um lote a cada 250ms começando 300ms depois da primeira pintura —
  // ou seja, ~35 chunks baixando em cima do boot, disputando banda com o que o
  // usuário está de fato esperando (a biblioteca, as capas, o primeiro
  // snapshot da nuvem). O aquecimento existe para a navegação FUTURA; ele pode
  // esperar o navegador ficar sem nada melhor para fazer.
  //
  // O aquecimento por intenção (acima) continua imediato — é ele que faz a
  // navegação parecer instantânea, e ele só custa o chunk que o dedo apontou.
  const restantes = Object.keys(pageModules);
  const idle = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  const proximoLote = (): void => {
    const path = restantes.shift();
    if (path) warm(path);
    if (restantes.length === 0) return;
    if (typeof idle === 'function') idle(() => proximoLote(), { timeout: 10_000 });
    else setTimeout(proximoLote, 400);
  };
  // 1,5s de folga: tempo de a primeira tela pintar e a biblioteca aparecer.
  setTimeout(proximoLote, 1_500);
}

function Placeholder() {
  return (
    <EmptyState
      icon={Construction}
      title="Página em construção"
      description="Esta área do radinho.online chega em breve."
      className="min-h-[60vh] justify-center"
    />
  );
}

function lazyPage(name: string): ComponentType {
  const loader = pageModules[`/src/pages/${name}.tsx`];
  return lazy(loader ?? (() => Promise.resolve({ default: Placeholder })));
}

function page(name: string, skeleton: PageSkeletonProps['variant'] = 'home'): ReactNode {
  const Page = lazyPage(name);
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton variant={skeleton} />}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      // Auth lives OUTSIDE the shell.
      { path: '/login', element: page('LoginPage') },
      // O onboarding também fica fora da casca, e pelo mesmo motivo do login:
      // menu, player e abas oferecem uma dezena de saídas para uma tela cujo
      // propósito é receber UMA resposta. Ver OnboardingPage.
      { path: '/onboarding', element: page('OnboardingPage') },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: page('HomePage', 'home') },
          { path: '/search', element: page('SearchPage', 'list') },
          { path: '/library', element: page('LibraryPage', 'list') },
          { path: '/artistas', element: page('ArtistsPage', 'home') },
          { path: '/gravadoras', element: page('LabelsPage', 'home') },
          { path: '/liked', element: page('LikedPage', 'list') },
          { path: '/history', element: page('HistoryPage', 'list') },
          {
            path: '/downloads',
            element: <AuthorizedRoute>{page('DownloadsPage', 'list')}</AuthorizedRoute>,
          },
          {
            path: '/uploads',
            element: <AuthorizedRoute>{page('UploadsPage', 'list')}</AuthorizedRoute>,
          },
          { path: '/discover', element: page('DiscoverPage', 'home') },
          {
            path: '/dispositivo',
            element: <AuthorizedRoute>{page('DevicePage', 'list')}</AuthorizedRoute>,
          },
          {
            path: '/telemetria',
            element: <AuthorizedRoute>{page('TelemetryPage', 'list')}</AuthorizedRoute>,
          },
          { path: '/compartilhar', element: page('SharePage', 'list') },
          // Sem AuthorizedRoute de propósito: o diagnóstico precisa funcionar
          // JUSTAMENTE quando o login é a coisa que está quebrada.
          { path: '/diagnostico', element: page('DiagnosticoPage', 'list') },
          { path: '/catalogo/playlist/:id', element: page('CatalogPlaylistPage', 'detail') },
          { path: '/catalogo/artista/:id', element: page('CatalogArtistPage', 'detail') },
          { path: '/radios', element: page('RadiosPage', 'home') },
          { path: '/podcasts', element: page('PodcastsPage', 'home') },
          { path: '/podcast/:id', element: page('PodcastPage', 'detail') },
          { path: '/playlist/:id', element: page('PlaylistPage', 'detail') },
          { path: '/album/:id', element: page('AlbumPage', 'detail') },
          { path: '/artist/:id', element: page('ArtistPage', 'detail') },
          // Local library (Spotify-style) — grouped from on-device metadata.
          { path: '/artista/:name', element: page('ArtistLocalPage', 'detail') },
          { path: '/gravadora/:name', element: page('LabelLocalPage', 'detail') },
          { path: '/genero/:name', element: page('GenreLocalPage', 'detail') },
          { path: '/mix/:key', element: page('MixPage', 'detail') },
          // Public share landing (link sent by a user) — works signed-out.
          { path: '/s/:id', element: page('SharedPage', 'detail') },
          { path: '/disco/:key', element: page('AlbumLocalPage', 'detail') },
          { path: '/album-apple/:id', element: page('AppleAlbumPage', 'detail') },
          { path: '/profile/:handle', element: page('ProfilePage', 'detail') },
          { path: '/settings', element: page('SettingsPage', 'list') },
          { path: '/admin/*', element: page('AdminPage', 'list') },
          { path: '*', element: page('NotFoundPage') },
        ],
      },
    ],
  },
]);
