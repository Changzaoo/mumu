import { useCallback, type MouseEvent } from 'react';
import { useLocation } from 'react-router';
import { useScrollContainer } from '@/app/layout/scroll-context';
import { useSemMovimento } from '@/hooks/useSemMovimento';

/**
 * TOCAR EM "INÍCIO" ESTANDO NA INÍCIO VOLTA AO TOPO — como Spotify e Instagram.
 *
 * Sem isto o toque não fazia nada: o link apontava para a própria página, o
 * roteador não trocava de rota e o AppShell só zera a rolagem QUANDO a rota
 * muda. Em outra rota o link segue o caminho normal (navega, e a página nova
 * já nasce no topo).
 *
 * Quem rola é o <main> do AppShell (ScrollContainerContext), não a janela: no
 * toque o documento é fixo. Com "menos movimento" o salto é seco.
 */
export function useVoltarAoTopo(): (event: MouseEvent<HTMLAnchorElement>, to: string) => void {
  const { pathname } = useLocation();
  const scrollEl = useScrollContainer();
  const semMovimento = useSemMovimento();

  return useCallback(
    (event, to) => {
      if (to !== '/' || pathname !== '/') return;
      // Ctrl/⌘-clique abre em outra aba — isso continua sendo do navegador.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!scrollEl || scrollEl.scrollTop <= 0) return;
      scrollEl.scrollTo({ top: 0, behavior: semMovimento ? 'auto' : 'smooth' });
    },
    [pathname, scrollEl, semMovimento],
  );
}
