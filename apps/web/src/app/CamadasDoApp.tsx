import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import {
  definirPaginaAtual,
  registrarReabridor,
  useCamadaNoHistorico,
} from '@/lib/historico/camadas';
import { useUiStore } from '@/stores/uiStore';

/**
 * As camadas que vivem na uiStore entram no histórico por aqui (as de Radix —
 * diálogo, folha, menu — entram sozinhas, em components/ui).
 *
 * A ORDEM DAS DUAS CHAMADAS IMPORTA: o player é a camada de baixo e a letra,
 * dentro dele, a de cima. Quem abre a letra com o player já aberto empurra a
 * segunda entrada; quem reabre o player com a letra lembrada empurra as duas,
 * nesta ordem.
 *
 * A fila em painel lateral (desktop) NÃO é camada: é parte da página, e o
 * voltar não deve fechá-la. No celular a fila é uma folha Radix.
 */
export function CamadasDoApp(): null {
  const { key } = useLocation();
  // Antes de qualquer `popstate` ser tratado, o gerente precisa saber em que
  // página o router está: é como ele distingue "voltei até a página de baixo"
  // de "o router vai trocar de página".
  useLayoutEffect(() => definirPaginaAtual(key), [key]);

  const player = useUiStore((s) => s.nowPlayingOpen);
  const letra = useUiStore((s) => s.lyricsOpen);

  useCamadaNoHistorico(
    player,
    () => useUiStore.getState().setNowPlayingOpen(false),
    'player',
    () => useUiStore.getState().nowPlayingOpen,
  );
  useCamadaNoHistorico(
    player && letra,
    () => useUiStore.getState().setLyricsOpen(false),
    'letra',
    () => useUiStore.getState().nowPlayingOpen && useUiStore.getState().lyricsOpen,
  );

  // "Avançar" do navegador reabre o que o voltar fechou.
  useEffect(() => {
    const sairPlayer = registrarReabridor('player', () =>
      useUiStore.getState().setNowPlayingOpen(true),
    );
    const sairLetra = registrarReabridor('letra', () => {
      const ui = useUiStore.getState();
      ui.setNowPlayingOpen(true);
      ui.setLyricsOpen(true);
    });
    return () => {
      sairPlayer();
      sairLetra();
    };
  }, []);

  return null;
}
