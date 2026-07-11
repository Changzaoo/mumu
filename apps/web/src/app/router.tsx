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
import { ErrorBoundary, RouteErrorBoundary } from '@/app/RouteErrorBoundary';
import { RootLayout } from '@/app/RootLayout';

const pageModules = import.meta.glob<{ default: ComponentType }>('/src/pages/*.tsx');

function Placeholder() {
  return (
    <EmptyState
      icon={Construction}
      title="Página em construção"
      description="Esta área do Aurial chega em breve."
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
      {
        element: <AppShell />,
        children: [
          { path: '/', element: page('HomePage', 'home') },
          { path: '/search', element: page('SearchPage', 'list') },
          { path: '/library', element: page('LibraryPage', 'list') },
          { path: '/liked', element: page('LikedPage', 'list') },
          { path: '/history', element: page('HistoryPage', 'list') },
          { path: '/downloads', element: page('DownloadsPage', 'list') },
          { path: '/uploads', element: page('UploadsPage', 'list') },
          { path: '/discover', element: page('DiscoverPage', 'home') },
          { path: '/radios', element: page('RadiosPage', 'home') },
          { path: '/podcasts', element: page('PodcastsPage', 'home') },
          { path: '/podcast/:id', element: page('PodcastPage', 'detail') },
          { path: '/playlist/:id', element: page('PlaylistPage', 'detail') },
          { path: '/album/:id', element: page('AlbumPage', 'detail') },
          { path: '/artist/:id', element: page('ArtistPage', 'detail') },
          { path: '/profile/:handle', element: page('ProfilePage', 'detail') },
          { path: '/settings', element: page('SettingsPage', 'list') },
          { path: '/admin/*', element: page('AdminPage', 'list') },
          { path: '*', element: page('NotFoundPage') },
        ],
      },
    ],
  },
]);
