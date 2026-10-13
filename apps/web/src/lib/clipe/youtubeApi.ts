/**
 * O PLAYER DO YOUTUBE, EM DUAS PARTES QUE CARREGAM AO MESMO TEMPO.
 *
 * O jeito "oficial" (`new YT.Player(div, { videoId })`) é uma fila: baixa o
 * `iframe_api`, que baixa o `www-widgetapi.js`, que SÓ ENTÃO cria o iframe,
 * que só então baixa a página do embed, que só então pede o vídeo. Cada elo
 * espera o anterior, e o mais pesado (o embed) é o último a começar.
 *
 * Aqui o iframe é criado NA HORA do clique, direto, com `enablejsapi=1`. O
 * embed começa a baixar imediatamente, em paralelo com o script da API. Quando
 * a API chega, ela se ACOPLA ao iframe que já existe (`new YT.Player(iframe)`
 * — o embed responde ao "listening" dela a qualquer momento, carregado ou
 * não). O primeiro quadro deixa de esperar o aperto de mão do script.
 *
 * `aquecerClipe` abre as conexões antes do clique (DNS + TLS dos hosts que o
 * player usa) e já baixa a API, para o acoplamento ser instantâneo.
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

export interface YtEventos {
  onReady?: () => void;
  onStateChange?: (e: { data: number }) => void;
  onError?: (e: { data: number }) => void;
}

interface YtNamespace {
  Player: new (
    /** Um `<iframe>` já criado (com `enablejsapi=1`) — a API só se acopla a ele. */
    el: HTMLElement,
    opcoes: { events?: YtEventos },
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

/** Sem cookies do YouTube no domínio do app. */
export const HOST_DO_EMBED = 'https://www.youtube-nocookie.com';

/**
 * O endereço do embed, com tudo o que o modo clipe precisa já na URL: mudo e
 * em autoplay (os navegadores só deixam autoplay mudo), sem controles, sem
 * teclado, começando no segundo em que o som está, e com `enablejsapi` +
 * `origin` para a API poder conversar com ele por `postMessage`.
 *
 * Pura: recebe a origem da página em vez de ler `location`, para ser testável.
 */
export function urlDoEmbed(videoId: string, inicioS: number, origem: string): string {
  const q = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    iv_load_policy: '3',
    modestbranding: '1',
    playsinline: '1',
    rel: '0',
    start: String(Math.max(0, Math.floor(inicioS))),
    enablejsapi: '1',
  });
  // Um `origin` que não é http(s) (o `file://` de um WebView antigo) faria o
  // embed recusar as mensagens; sem ele a API ainda funciona, só sem a checagem.
  if (/^https?:\/\//.test(origem)) q.set('origin', origem);
  return `${HOST_DO_EMBED}/embed/${encodeURIComponent(videoId)}?${q.toString()}`;
}

/**
 * Cria o `<iframe>` do clipe e o pendura em `caixa`. O embed começa a baixar
 * neste instante — antes de a API do YouTube existir.
 */
export function criarIframeDoClipe(
  caixa: HTMLElement,
  videoId: string,
  inicioS: number,
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = urlDoEmbed(videoId, inicioS, window.location.origin);
  iframe.title = 'Clipe';
  iframe.tabIndex = -1;
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('loading', 'eager');
  iframe.setAttribute('fetchpriority', 'high');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  caixa.appendChild(iframe);
  return iframe;
}

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

/** Acopla a API a um iframe que já existe. Resolve com o player quando a API chegar. */
export async function acoplarPlayer(
  iframe: HTMLIFrameElement,
  events: YtEventos,
): Promise<YtPlayer> {
  const YT = await carregarYoutube();
  return new YT.Player(iframe, { events });
}

let aquecido = false;

/** Pré-conecta aos hosts do player e já baixa a API, sem criar player nenhum. */
export function aquecerClipe(): void {
  if (aquecido || typeof document === 'undefined') return;
  aquecido = true;
  for (const href of [HOST_DO_EMBED, 'https://www.youtube.com', 'https://i.ytimg.com']) {
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
