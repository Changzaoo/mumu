import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        // Never serve the SPA shell for API / importer-proxy calls.
        navigateFallbackDenylist: [/^\/api/, /^\/importer/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'aurial-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
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
      '/api': 'http://localhost:4000',
      // Dev mirror of the Vercel rewrite: /importer/* → Cloudflare tunnel → home
      // importer. Keeps the app same-origin in dev too (no CORS locally).
      '/importer': {
        target: 'https://importer.nexusholding.xyz',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/importer/, ''),
      },
    },
  },
});
