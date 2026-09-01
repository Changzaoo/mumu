import { useEffect } from 'react';
import { marcarDesempenho, monitorarDesempenho } from '@/lib/perf/dispositivo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MotionConfig } from 'framer-motion';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initPlayerEngine } from '@/stores/playerStore';
import { initSettings, useSettingsStore, type ReducedMotionSetting } from '@/stores/settingsStore';
import { marcarBoot, medirEtapa } from '@/lib/telemetry/bootPerf';
import { router } from '@/app/router';
import { ligarCacheDePaginas } from '@/lib/perf/cacheDePaginas';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Trocar de página só é instantâneo se a página tiver o que mostrar no
      // primeiro quadro. Com o `gcTime` padrão (5 min) o cache de uma página
      // visitada há pouco já tinha sido descartado, e voltar para ela mostrava
      // o esqueleto de novo, como se fosse a primeira visita. Meia hora de
      // cache faz a volta pintar na hora — os dados velhos aparecem primeiro e
      // a revalidação acontece atrás, sem esqueleto.
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// O cache acima passa a sobreviver ao fechar do app (IndexedDB): a página
// pinta com o que se sabia da última vez e revalida por trás. Era a fatia da
// "página demora a carregar" que não estava no cliente — ver cacheDePaginas.ts.
ligarCacheDePaginas(queryClient);

const MOTION_MAP: Record<ReducedMotionSetting, 'user' | 'always' | 'never'> = {
  system: 'user',
  on: 'always',
  off: 'never',
};

export default function App() {
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);

  useEffect(() => {
    marcarBoot('app-montado');
    // ANTES DE DESENHAR QUALQUER COISA: decide se este aparelho aguenta os
    // efeitos caros. O resultado vira um atributo no <html> e o CSS se ajusta
    // sozinho — se ficasse para depois, a primeira tela nasceria com o vidro
    // ligado e o travamento apareceria justamente na abertura, que é quando
    // mais incomoda. Ver lib/perf/dispositivo.ts.
    marcarDesempenho();
    // A heurística acima é um palpite; o monitor abaixo é a medição. Ele fica de
    // olho nos quadros e, se a rolagem engasgar de verdade, rebaixa na hora e
    // lembra disso para os próximos boots. Ver lib/perf/dispositivo.ts.
    monitorarDesempenho();
    // O player é o único que sobe na hora: ele restaura "de onde parou" e
    // precisa estar de pé antes de qualquer toque no botão de play.
    initPlayerEngine();

    // O RESTO ENTRA POR IMPORT DINÂMICO — sincronia, fila de importação,
    // telemetria, presença, agente de gênero e pesquisador. Nada disso é
    // necessário para desenhar a primeira tela, e enquanto vinham por import
    // estático os módulos deles (e as dependências que eles arrastam) tinham
    // que ser baixados e EXECUTADOS antes do primeiro pixel. Agora carregam em
    // paralelo com a renderização; alguns milissegundos mais tarde, invisíveis
    // para o usuário, mas fora da frente da tela.
    let pararPesquisador: (() => void) | null = null;
    let pararReparador: (() => void) | null = null;
    let pararAssimilador: (() => void) | null = null;
    let cancelado = false;
    void (async () => {
      const [
        sync,
        catalogo,
        fila,
        telemetria,
        presenca,
        genero,
        pesquisador,
        reparador,
        detalhe,
        guardiao,
        biblioteca,
      ] = await Promise.all([
        import('@/lib/sync/syncManager'),
        import('@/lib/sync/catalogoBoot'),
        import('@/lib/local/importQueue'),
        import('@/lib/telemetry/telemetry'),
        import('@/lib/devices/presence'),
        import('@/lib/local/genreAgent'),
        import('@/lib/local/pesquisador'),
        import('@/lib/local/reparador'),
        import('@/lib/local/detalheDaFaixa'),
        import('@/lib/offline/guardiaoOffline'),
        import('@/lib/local/localLibrary'),
      ]);
      if (cancelado) return;
      // O REGISTRO DA BIBLIOTECA PRIMEIRO. Ele mora no IndexedDB (4 mil faixas
      // não cabem nos ~5 MB do localStorage) e, enquanto não carrega, NADA
      // persiste — é a trava que impede uma biblioteca pela metade de ser
      // gravada por cima da inteira. Ver lib/local/localLibrary.ts.
      await medirEtapa('biblioteca.hydrate', () => biblioteca.hydrate());
      if (cancelado) return;
      // CADA UM MEDIDO SEPARADAMENTE. Onze subsistemas sobem aqui, e até agora o
      // relatório de boot mostrava um bloco só: "está pesado na abertura" não
      // apontava para nenhum deles. `radinhoPerf()` agora imprime o custo de
      // cada linha desta lista — a próxima vez que a abertura pesar, a evidência
      // já está no aparelho de quem reclamou, em vez de num palpite daqui.
      await medirEtapa('sync.initCloudSync', () => sync.initCloudSync());
      // acervo do app: o que o admin adiciona chega em todos
      await medirEtapa('catalogo.initCatalogo', () => catalogo.initCatalogo());
      await medirEtapa('fila.init', () => fila.init()); // retoma downloads da sessão anterior
      await medirEtapa('telemetria.initTelemetry', () => telemetria.initTelemetry());
      // "tocando em {aparelho}" entre dispositivos da conta
      await medirEtapa('presenca.initPresence', () => presenca.initPresence());
      // plantão que categoriza a biblioteca por gênero (IA)
      await medirEtapa('genero.initGenreAgent', () => genero.initGenreAgent());
      // "Se você viu a música, ela toca": traz os bytes para o aparelho ANTES de
      // precisar deles, para o servidor fora do ar deixar de virar faixa que
      // aparece e não toca. Ver lib/offline/guardiaoOffline.ts.
      await medirEtapa('guardiao.initGuardiaoOffline', () => guardiao.initGuardiaoOffline());
      // Agente pesquisador: DESLIGADO por padrão. Ele confere o interruptor a
      // cada rodada, então desligar nas configurações para o agente na hora.
      pararPesquisador = pesquisador.iniciarPesquisador(
        () => useSettingsStore.getState().pesquisadorAtivo,
      );
      // Reparador: LIGADO, e a diferença para o pesquisador é o consentimento.
      // O pesquisador sai atrás de música que ninguém pediu; este só rebaixa de
      // novo faixa que a pessoa mandou tocar e que falhou na cara dela. Poucas
      // por rodada, e ele nunca se declara consertado — quem encerra o caso é o
      // player, quando sai som. Ver lib/local/reparador.ts.
      pararReparador = reparador.iniciarReparador();
      // Assimilador: adianta o CONTEÚDO das faixas que estão prestes a tocar,
      // para que apertar play não espere uma ida à rede. Ele nunca corre atrás
      // do acervo inteiro — isso desfaria o ganho de memória em câmera lenta.
      // Ver lib/local/detalheDaFaixa.ts.
      pararAssimilador = detalhe.iniciarAssimilador();
    })();

    // App de verdade no celular: sem menu de long-press do navegador (abrir em
    // nova aba, salvar imagem…). Só em telas de toque — o desktop mantém o
    // botão direito normal.
    const blockContextMenu = (event: Event): void => {
      if (window.matchMedia('(pointer: coarse)').matches) event.preventDefault();
    };
    document.addEventListener('contextmenu', blockContextMenu);

    const cleanupSettings = initSettings();
    return () => {
      cancelado = true;
      pararPesquisador?.();
      pararReparador?.();
      pararAssimilador?.();
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
