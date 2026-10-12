/**
 * A IFrame API do YouTube, carregada uma vez e só quando alguém vai ver clipe.
 *
 * `aquecerClipe` abre as conexões antes do clique (DNS + TLS dos três hosts
 * que o player usa), para que o primeiro quadro não espere aperto de mão.
 */

export interface YtPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(segundos: number, permitirBusca: boolean): void;
  mute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

interface YtNamespace {
  Player: new (
    el: HTMLElement,
    opcoes: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** `YT.PlayerState` — copiado para não depender do global antes de carregar. */
export const ESTADO = { ACABOU: 0, TOCANDO: 1, PAUSADO: 2, CARREGANDO: 3, PRONTO: 5 } as const;

let carregando: Promise<YtNamespace> | null = null;

export function carregarYoutube(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (carregando) return carregando;
  carregando = new Promise<YtNamespace>((resolve, reject) => {
    const anterior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      anterior?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      carregando = null;
      s.remove();
      reject(new Error('iframe_api não carregou'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

let aquecido = false;

/** Pré-conecta aos hosts do player e já baixa a API, sem criar player nenhum. */
export function aquecerClipe(): void {
  if (aquecido || typeof document === 'undefined') return;
  aquecido = true;
  for (const href of [
    'https://www.youtube-nocookie.com',
    'https://www.youtube.com',
    'https://i.ytimg.com',
  ]) {
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = href;
    l.crossOrigin = '';
    document.head.appendChild(l);
  }
  void carregarYoutube().catch(() => {
    aquecido = false;
  });
}
