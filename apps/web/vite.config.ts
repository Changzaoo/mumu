import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import {
  CSS_DA_CENA,
  htmlDaCena,
  scriptDaCena,
  scriptDoHead,
} from './src/components/brand/aberturaCena';

/**
 * A ABERTURA DENTRO DO index.html (ver src/components/brand/aberturaCena.ts):
 * a cena começa no primeiro quadro, antes do JS do app chegar, e o tema
 * guardado é aplicado antes de qualquer pintura.
 */
function aberturaNoHtml(): Plugin {
  return {
    name: 'radinho-abertura-no-html',
    transformIndexHtml(html) {
      return html
        .replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />
    <script>${scriptDoHead()}</script>
    <style>${CSS_DA_CENA}</style>`,
        )
        .replace(
          '<div id="root"></div>',
          `<div id="root"></div>${htmlDaCena()}<script>${scriptDaCena()}</script>`,
        );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    aberturaNoHtml(),
    VitePWA({
      // 'autoUpdate': o worker novo PULA A ESPERA e ASSUME os clientes sozinho
      // (skipWaiting + clientsClaim abaixo). Sem isto o SW ficava "aguardando"
      // e servia o bundle velho por tempo indeterminado — e não dá para pedir
      // a cada usuário que limpe o cache na mão. Quem cuida de recarregar a
      // página preservando a música é `src/pwa.ts` (no `controllerchange`).
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'radinho.online',
        short_name: 'radinho',
        description: 'radinho.online — sua rádio de música online',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        // "Compartilhar → radinho" no app do Spotify/YouTube (Android, PWA
        // instalado). GET e só texto: nada de arquivo, nada de POST para o
        // service worker tratar. Ver src/pages/ReceberLinkPage.tsx.
        share_target: {
          action: '/receber',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Full-bleed + zona segura: é o que faz o Android usar o ícone do
          // APP (não o do navegador) na notificação de mídia e nos atalhos.
          {
            src: '/icons/pwa-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // O worker novo assume IMEDIATAMENTE, sem esperar todas as abas
        // fecharem, e passa a controlar as abas já abertas. É o par que faz o
        // `controllerchange` disparar em `src/pwa.ts` e a página se atualizar
        // sozinha. `cleanupOutdatedCaches` apaga o precache da versão anterior
        // para não sobrar bundle velho ocupando espaço nem sendo servido.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        /**
         * O QUE NÃO ENTRA NO PRECACHE.
         *
         * O precache é baixado INTEIRO na instalação do worker (e de novo a cada
         * deploy, para o que mudou): era ~3 MB em 91 arquivos, disputando banda
         * com a primeira abertura. Estes chunks são pesados E raros — a maioria
         * das sessões nunca os usa:
         *  - hls (~520 kB): só toca stream HLS;
         *  - firebase (~700 kB): visitante anônimo nem o carrega (lib/firebase.ts);
         *  - Telemetry/Admin/Device: telas de administração.
         * Eles continuam disponíveis offline: o `runtimeCaching` abaixo guarda cada
         * um na PRIMEIRA vez em que é baixado. O instalador do app (radinho.apk,
         * ~4,7 MB) nunca foi nem deve ser precacheado — o glob padrão não casa
         * `.apk`; a regra abaixo só torna isso explícito e à prova de mudança.
         */
        globIgnores: [
          '**/assets/hls-*.js',
          '**/assets/firebase-*.js',
          '**/assets/TelemetryPage-*.js',
          '**/assets/AdminPage-*.js',
          '**/assets/DevicePage-*.js',
          '**/*.apk',
        ],
        // Never serve the SPA shell for API / importer-proxy calls.
        // Arquivos de SEO não são rotas do app: servir o index.html no lugar
        // deles quebraria o sitemap para quem abre pelo navegador.
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/importer/,
          /^\/(sitemap\.xml|robots\.txt|og\.png)$/,
          // O botão "Baixar" navega para o APK: sem isto o worker responde com
          // o index.html e o Android baixa uma página no lugar do app.
          /^\/radinho\.apk$/,
          // Página de login do Firebase servida pelo nosso domínio (vercel.json):
          // é do Firebase, não do app — o worker não pode responder com o index.
          /^\/__\//,
        ],
        /**
         * A PÁGINA VEM DA REDE, NÃO DO CACHE (29/10/2026). Com o index.html
         * servido do precache, quem abria o app (o APK carrega o site) recebia
         * o bundle da VERSÃO ANTERIOR; a nova chegava em segundo plano e a
         * página recarregava — e a pessoa via uma abertura, depois outra, a
         * antiga. Agora a navegação busca o index.html na rede (3 s de prazo);
         * só sem rede (ou rede travada) o worker responde com a cópia guardada.
         */
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }: { request: Request; url: URL }) =>
              request.mode === 'navigate' &&
              !/^\/(api|importer|__\/)|^\/(sitemap\.xml|robots\.txt|og\.png|radinho\.apk)$/.test(
                url.pathname,
              ),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'radinho-paginas',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20 },
              plugins: [
                {
                  // Sem rede e sem cópia desta URL: a casca do app no precache.
                  handlerDidError: async () =>
                    (await caches.match('/index.html', { ignoreSearch: true })) ?? undefined,
                },
              ],
            },
          },
          {
            // Os chunks pesados e raros fora do precache (ver `globIgnores`).
            // Nome com hash do conteúdo = imutável → CacheFirst é seguro; a
            // expiração por quantidade joga fora as versões antigas.
            urlPattern: ({ url }: { url: URL }) =>
              /^\/assets\/(hls|firebase|TelemetryPage|AdminPage|DevicePage)-[^/]+\.js$/.test(
                url.pathname,
              ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aurial-chunks-raros',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          /**
           * CAPAS: CacheFirst, mas só do que É IMAGEM.
           *
           * A regra antiga aceitava `statuses: [0, 200]`. Como nenhum <img> de
           * capa pede CORS, toda capa das CDNs (iTunes, Deezer, YouTube) chegava
           * ao worker como resposta OPACA (status 0) — e opaca esconde o status
           * real: o 404 do YouTube para vídeo sem miniatura, o JSON de erro do
           * iTunes, a página de login de um Wi-Fi de hotel, tudo entrava no
           * cache como "capa" e era servido por 30 dias, inclusive com rede.
           * É a "imagem corrompida que não volta". Resposta opaca ainda cobra
           * ~7 MB de cota cada no Chrome (até 300 → a cota da origem inteira,
           * a mesma do áudio offline).
           *
           * Agora: pedido de outra origem vira CORS (as três CDNs mandam
           * `Access-Control-Allow-Origin: *`, conferido em 17/10/2026), então o
           * status é real; só 200 com `Content-Type: image/*` entra no cache;
           * CDN sem CORS cai para o pedido opaco de sempre, sem cachear; e sem
           * rede nem cache o erro chega ao <img>, onde a capa vira um fundo
           * neutro e é tentada de novo quando a rede volta
           * (lib/perf/capasResilientes.ts).
           */
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'aurial-images-v2',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  requestWillFetch: async ({ request }: { request: Request }) => {
                    const url = new URL(request.url);
                    if (url.origin === self.location.origin || request.mode === 'cors') {
                      return request;
                    }
                    return new Request(request.url, {
                      mode: 'cors',
                      credentials: 'omit',
                      referrerPolicy: 'no-referrer',
                    });
                  },
                  fetchDidSucceed: async ({ response }: { response: Response }) => {
                    // Com CORS o status é real. O 404 do YouTube vem com um JPEG
                    // cinza no corpo: o <img> "carrega" um quadrado cinza e
                    // ninguém sabe que a capa não existe. Status ruim vira erro,
                    // e o erro chega ao <img> (lib/perf/capasResilientes.ts).
                    if (response.type !== 'opaque' && !response.ok) {
                      const erro = new Error(`capa ${response.status}`);
                      erro.name = 'CapaIndisponivel';
                      throw erro;
                    }
                    return response;
                  },
                  cacheWillUpdate: async ({ response }: { response: Response }) => {
                    const tipo = response.headers.get('content-type') ?? '';
                    return response.status === 200 && tipo.startsWith('image/') ? response : null;
                  },
                  handlerDidError: async ({
                    request,
                    error,
                  }: {
                    request: Request;
                    error?: Error;
                  }) => {
                    // Status ruim já foi julgado acima: não insiste.
                    if (error?.name === 'CapaIndisponivel') return undefined;
                    // CDN que não fala CORS: o pedido opaco de sempre, sem cache.
                    // Sem rede, devolve nada: o erro chega ao <img>, e é lá
                    // (lib/perf/capasResilientes.ts) que a capa vira fundo neutro
                    // e é tentada de novo quando a rede volta — um fundo servido
                    // daqui como "200" enganaria o app, que nunca tentaria.
                    try {
                      const opaca = await fetch(request.url, { mode: 'no-cors' });
                      if (opaca.type === 'opaque') return opaca;
                    } catch {
                      /* sem rede */
                    }
                    return undefined;
                  },
                },
              ],
            },
          },
          /**
           * O SERVICE WORKER NÃO ENCOSTA EM ÁUDIO — e `/api/v1/stream/` É áudio.
           *
           * A regra abaixo pega toda a API, e o manifesto HLS e os segmentos
           * moram em `/api/v1/stream/:trackId/...` (ver `mappers.ts:96` e
           * `modules/stream`). Deixá-los cair aqui produzia dois estragos, os
           * dois em cima da reprodução:
           *
           *  1. `networkTimeoutSeconds: 4` — passados 4 segundos o worker
           *     DESISTE da rede e responde do cache. Para JSON isso é bom; para
           *     áudio é o contrário do que este player precisa. O cofre se
           *     refaz: quando a poda levou os bytes, o importador reextrai a
           *     faixa e isso leva 20 a 25 segundos medidos — é por isso que o
           *     watchdog espera 60s. O worker cortava em 4, e como não há
           *     segmento nenhum no cache, a resposta era o nada;
           *  2. resposta **206** (que é como qualquer servidor de mídia atende
           *     um `Range`) não pode ser guardada: `cache.put` lança com
           *     resposta parcial. Enquanto não houver suporte a Range no
           *     worker, áudio fica de fora — restrição da fase 2.
           *
           * Streams de outras origens (cofre do importador, Audius) nem chegam
           * a casar com este padrão; o buraco era só o do próprio acervo.
           */
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.includes('/api/v1/') && !url.pathname.includes('/api/v1/stream/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aurial-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Vendors em chunks próprios.
         *
         * Antes tudo caía num único `index.js` de ~1,5 MB: qualquer mudança de
         * uma linha nossa trocava o hash do arquivo inteiro e o usuário
         * rebaixava React, Firebase e companhia a cada deploy. Separados, o
         * navegador baixa em paralelo e — o que mais importa — REAPROVEITA os
         * pedaços que não mudaram entre uma versão e outra.
         *
         * Só bibliotecas com peso próprio ganham chunk; o resto continua junto,
         * porque dezenas de arquivinhos custam mais em requisições do que
         * economizam em bytes.
         */
        manualChunks(id) {
          const caminho = id.split('\\').join('/');
          if (!caminho.includes('/node_modules/')) return;
          if (caminho.includes('/firebase/') || caminho.includes('/@firebase/')) return 'firebase';
          if (/\/(react|react-dom|scheduler)\//.test(caminho)) return 'react';
          if (caminho.includes('/react-router')) return 'router';
          if (caminho.includes('/framer-motion/') || caminho.includes('/motion-dom/')) {
            return 'motion';
          }
          if (caminho.includes('/@tanstack/')) return 'query';
          if (caminho.includes('/zod/')) return 'zod';
          if (caminho.includes('/howler/')) return 'howler';
          if (caminho.includes('/lucide-react/') || caminho.includes('/react-icons/')) {
            return 'icons';
          }
          if (caminho.includes('/@radix-ui/')) return 'radix';
          return;
        },
      },
    },
  },
  server: {
    proxy: {
      // `DEV_API_PROXY=https://api.radinho.online` aponta o dev para a API de
      // produção (só leitura anônima) quando não há API local — a API recusa
      // a origem localhost, então tem que ser pelo proxy, que não manda Origin.
      '/api': {
        target: process.env.DEV_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
        secure: true,
      },
      // Dev mirror of the Vercel rewrite: /importer/* → Cloudflare tunnel → home
      // importer. Keeps the app same-origin in dev too (no CORS locally).
      '/importer': {
        target: 'https://importer.radinho.online',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/importer/, ''),
      },
    },
  },
});
