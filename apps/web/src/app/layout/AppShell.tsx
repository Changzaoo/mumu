import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { EqualizerPanel } from '@/components/media/EqualizerPanel';
import { ResumeElsewhereBanner } from '@/components/media/ResumeElsewhereBanner';
import { ShareDialogHost } from '@/components/media/ShareDialog';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import * as gostoInicial from '@/lib/local/gostoInicial';
import { recordNavigation } from '@/lib/telemetry/telemetry';
import { cn, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';
import { MiniPlayer } from '@/app/layout/MiniPlayer';
import { MobileNav } from '@/app/layout/MobileNav';
import { NowPlaying } from '@/app/layout/NowPlaying';
import { PlayerBar } from '@/app/layout/PlayerBar';
import { QueuePanel } from '@/app/layout/QueuePanel';
import { ScrollContainerContext } from '@/app/layout/scroll-context';
import { Sidebar } from '@/app/layout/Sidebar';
import { TopBar } from '@/app/layout/TopBar';

/**
 * ROTAS QUE NUNCA SAO INTERROMPIDAS PELO ONBOARDING.
 *
 * Um link compartilhado (`/s/:id`) chega de fora, muitas vezes de alguém que só
 * quer ouvir aquela música; sequestrar essa chegada para uma pergunta é a forma
 * mais rápida de a pessoa fechar a aba. E `/diagnostico` existe justamente para
 * quando a sessão está quebrada — atravessá-lo com um redirecionamento que
 * DEPENDE do estado da sessão tiraria do ar a ferramenta que serve para
 * investigar esse estado.
 */
const SEM_INTERRUPCAO = ['/s/', '/diagnostico', '/compartilhar'];

/**
 * Falta perguntar o gosto a esta pessoa, aqui e agora?
 *
 * A pergunta é feita na casca, e não só na tela de login, porque quem já estava
 * logado antes desta tela existir nunca mais passa pelo `/login` — e é
 * exatamente quem mais se beneficia de responder. O "Agora não" grava a
 * resposta vazia, então ninguém fica preso no laço.
 */
function usePrecisaEscolherGosto(pathname: string): boolean {
  const { user, loading } = useAuthUser();
  const respondeu = useSyncExternalStore(
    gostoInicial.subscribe,
    gostoInicial.respondeu,
    () => true, // no servidor não se redireciona nada
  );
  if (loading || !user || respondeu) return false;
  return !SEM_INTERRUPCAO.some((p) => pathname === p || pathname.startsWith(p));
}

/** Screen-reader live region announcing track changes (DESIGN §10). */
function TrackAnnouncer() {
  const track = usePlayerStore((s) => s.currentTrack);
  return (
    <div aria-live="polite" className="sr-only">
      {track ? `Tocando ${track.title} de ${trackArtistNames(track)}` : ''}
    </div>
  );
}

/**
 * App shell (DESIGN §7):
 *
 *   ┌─ moldura (bg-deep) ─────────────────────────┐
 *   │ ┌────────┐ ┌───────────────────┐ ┌────────┐ │
 *   │ │Sidebar │ │ main — TopBar     │ │ Queue* │ │
 *   │ └────────┘ └───────────────────┘ └────────┘ │
 *   │ ┌─────────────────────────────────────────┐ │
 *   │ │ PlayerBar (88px) — LINHA, não `fixed`   │ │
 *   │ └─────────────────────────────────────────┘ │
 *   └─────────────────────────────────────────────┘
 *
 * O player era `fixed inset-x-0`, uma faixa presa à janela inteira — e por isso
 * passava POR CIMA da barra lateral. Sendo a última linha do layout, o menu e o
 * conteúdo ficam acima dele e a sobreposição deixa de ser possível.
 *
 * Mobile: MobileNav tabs + MiniPlayer. The player never unmounts — page
 * transitions (fade + 8px rise, 320ms) only wrap the <Outlet/>.
 */
export function AppShell() {
  const location = useLocation();
  const precisaEscolherGosto = usePrecisaEscolherGosto(location.pathname);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const queueOpen = useUiStore((s) => s.queueOpen);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Reset page scroll on navigation (keep player untouched) + telemetry.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    recordNavigation(location.pathname);
  }, [location.pathname]);

  // iOS: o Safari IGNORA overscroll-behavior em scrollers internos e quica o
  // conteúdo (vão vazio em cima ao puxar). Guarda de toque determinística:
  // cancela o gesto VERTICAL só quando o scroll já está na borda — pan
  // horizontal (prateleiras) e o scroll normal seguem intactos.
  useEffect(() => {
    const el = scrollEl;
    if (!el || !/iP(hone|od|ad)/.test(navigator.userAgent)) return;
    let startX = 0;
    let startY = 0;
    const onStart = (event: TouchEvent): void => {
      startX = event.touches[0]?.clientX ?? 0;
      startY = event.touches[0]?.clientY ?? 0;
    };
    const onMove = (event: TouchEvent): void => {
      const x = event.touches[0]?.clientX ?? 0;
      const y = event.touches[0]?.clientY ?? 0;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.abs(dy) <= Math.abs(dx)) return; // gesto horizontal — deixa passar
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) event.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, [scrollEl]);

  // Depois de TODOS os hooks: um retorno antecipado mais acima mudaria a ordem
  // deles entre renders, que é o jeito clássico de quebrar as regras do React
  // com um redirecionamento condicional.
  if (precisaEscolherGosto) return <Navigate to="/onboarding" replace />;

  return (
    <ScrollContainerContext.Provider value={scrollEl}>
      {/* A MOLDURA. O app era uma folha só, sangrando até as bordas da janela;
          agora são painéis arredondados sobre um fundo mais profundo, com
          calhas entre eles. No celular a moldura some (`p-0`): margem em tela
          pequena é espaço roubado de conteúdo. */}
      <div className="ambiente-vidro relative isolate flex h-dvh flex-col overflow-hidden p-0 text-fg md:gap-2 md:p-2">
        {/* Fundo vivo: brilhos que derivam devagar atrás do vidro (globals.css
            .aurora). Fica atrás de tudo (-z-1); o conteúdo central (main) é
            opaco e o esconde, então só aparece refratado pelas superfícies de
            vidro — o fundo do player, do menu e das abas. */}
        <div className="aurora" aria-hidden="true">
          <span className="aurora-blob aurora-1" />
          <span className="aurora-blob aurora-2" />
          <span className="aurora-blob aurora-3" />
        </div>
        <div className="flex min-h-0 flex-1 md:gap-2">
          <Sidebar />

          <main
            ref={(node) => {
              scrollRef.current = node;
              setScrollEl(node);
            }}
            // overscroll-y-NONE (não 'contain'): o Chrome Android 12+ estica o
            // conteúdo do scroller ao puxar além do topo — 'contain' só impede
            // o encadeamento ao body, 'none' desliga o efeito por completo.
            className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-none bg-bg px-4 md:rounded-xl md:px-6 lg:px-8"
          >
            <TopBar />
            <div
              className={cn(
                'mx-auto w-full max-w-[1600px]',
                // Só o rodapé do CELULAR precisa ser compensado: lá as abas e o
                // mini player flutuam por cima. No desktop o PlayerBar deixou de
                // ser `fixed` e ocupa a própria linha do layout — reservar
                // espaço para ele aqui abriria um vão morto no fim da página.
                //
                // 4rem de abas + 4rem de mini player + folga. Era 10.5rem porque
                // havia 1rem de vão entre os dois; sem o vão, o mesmo valor
                // viraria espaço morto no fim de toda página.
                hasTrack
                  ? 'pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-8'
                  : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8',
              )}
            >
              {/* Navegação sem animação nenhuma.
                  O fade de 120ms parecia sofisticado e custava caro: a página
                  nova nascia invisível, então TODA troca de página começava com
                  um piscar de conteúdo faltando antes de aparecer. Sem ele, o
                  conteúdo entra no primeiro quadro. A chave por pathname fica —
                  é ela que garante que a página nova começa do zero. */}
              <div key={location.pathname}>
                <Outlet />
              </div>
            </div>
          </main>

          {queueOpen && isDesktop && <QueuePanel />}
        </div>

        <PlayerBar />
        <MiniPlayer />
        <MobileNav />
        <NowPlaying />
        <EqualizerPanel />
        <ShareDialogHost />
        <ResumeElsewhereBanner />
        <TrackAnnouncer />
      </div>
    </ScrollContainerContext.Provider>
  );
}
