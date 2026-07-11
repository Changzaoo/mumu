import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MotionConfig } from 'framer-motion';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initPlayerEngine } from '@/stores/playerStore';
import { initSettings, useSettingsStore, type ReducedMotionSetting } from '@/stores/settingsStore';
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
    return initSettings();
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
