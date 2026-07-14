import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MotionConfig } from 'framer-motion';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initPlayerEngine } from '@/stores/playerStore';
import { initSettings, useSettingsStore, type ReducedMotionSetting } from '@/stores/settingsStore';
import { initCloudSync } from '@/lib/sync/syncManager';
import { init as initImportQueue } from '@/lib/local/importQueue';
import { initTelemetry } from '@/lib/telemetry/telemetry';
import { initPresence } from '@/lib/devices/presence';
import { initGenreAgent } from '@/lib/local/genreAgent';
import { router } from '@/app/router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const MOTION_MAP: Record<ReducedMotionSetting, 'user' | 'always' | 'never'> = {
  system: 'user',
  on: 'always',
  off: 'never',
};

export default function App() {
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);

  useEffect(() => {
    initPlayerEngine();
    initCloudSync();
    initImportQueue(); // resume any downloads queued before a reload
    initTelemetry(); // usage metrics for the admin /telemetria page
    initPresence(); // "tocando em {aparelho}" entre dispositivos da conta
    initGenreAgent(); // plantão que categoriza a biblioteca por gênero (IA)

    // App de verdade no celular: sem menu de long-press do navegador (abrir em
    // nova aba, salvar imagem…). Só em telas de toque — o desktop mantém o
    // botão direito normal.
    const blockContextMenu = (event: Event): void => {
      if (window.matchMedia('(pointer: coarse)').matches) event.preventDefault();
    };
    document.addEventListener('contextmenu', blockContextMenu);

    const cleanupSettings = initSettings();
    return () => {
      document.removeEventListener('contextmenu', blockContextMenu);
      cleanupSettings?.();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={MOTION_MAP[reducedMotion]}>
        <TooltipProvider delayDuration={400}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </MotionConfig>
      <Toaster />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
