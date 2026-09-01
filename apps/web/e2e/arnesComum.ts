/// <reference lib="dom" />
/**
 * PEÇAS COMPARTILHADAS DOS ARNESES DE DESEMPENHO (abertura e navegação).
 *
 * Extraídas de `desempenho.spec.ts` quando o arnês de navegação nasceu: os dois
 * precisam da MESMA biblioteca semeada e do MESMO corte de rede, e duas cópias
 * divergiriam na primeira correção. Os comentários de cada peça continuam nela.
 *
 * A referência de DOM vale só aqui, pelo mesmo motivo do spec original: os
 * corpos de `page.evaluate` executam no navegador.
 */
import type { Page } from '@playwright/test';

/**
 * Semeia N entradas no registro (IndexedDB), no MESMO formato que o app grava.
 *
 * Roda dentro da página, e não por fixture, porque o registro é IndexedDB puro
 * — não há caminho de rede para injetá-lo por fora.
 */
export async function semear(page: Page, quantas: number): Promise<void> {
  if (quantas === 0) return;
  await page.evaluate(async (n: number) => {
    const entradas = Array.from({ length: n }, (_, i) => {
      const id = `local:seed-${i}`;
      return {
        track: {
          id,
          title: `Faixa de teste ${i}`,
          durationMs: 225_000,
          trackNumber: 1,
          discNumber: 1,
          explicit: false,
          playsCount: 0,
          dominantColor: null,
          loudnessLufs: -10,
          isLiked: false,
          album: {
            id: `album-${i % 400}`,
            title: `Álbum ${i % 400}`,
            slug: `album-${i % 400}`,
            coverUrl: null,
          },
          artists: [
            {
              id: `artist-${i % 300}`,
              name: `Artista ${i % 300}`,
              slug: `artist-${i % 300}`,
              imageUrl: null,
            },
          ],
          // Gênero em parte do acervo: sem isto o agente de gênero veria a
          // biblioteca INTEIRA como pendente, que não é o caso comum.
          genre: i % 3 === 0 ? null : ['Pop', 'Rock', 'Samba', 'K-Pop'][i % 4],
          // CAPA NA MAIORIA — e a primeira versão deste arnês errou aqui.
          //
          // Semear `coverUrl: null` em TODAS as entradas parece inofensivo e não
          // é: `restoreEmbeddedCovers` só vai ao IndexedDB para quem está sem
          // capa, então uma biblioteca 100% sem capa dispara uma leitura por
          // faixa e infla essa fase muito além do real. Uma de cada dez sem capa
          // é o que se vê numa biblioteca de verdade.
          coverUrl: i % 10 === 0 ? null : `https://cdn.exemplo.test/capa/${i % 400}.jpg`,
          streamUrl: null,
          uploadedByUserId: null,
        },
        addedAt: new Date(Date.now() - i * 60_000).toISOString(),
        sizeBytes: 8_000_000,
        mimeType: 'audio/mpeg',
        tocavel: true,
        // MISTURA DE DONO, e o outro erro da primeira versão.
        //
        // Marcar tudo como 'catalogo' zerava o custo que se queria medir:
        // `carregarRegistro` regrava o registro filtrando FORA o catálogo, então
        // uma biblioteca 100% emprestada gravava uma lista vazia e a regravação
        // saía de graça. A biblioteca de uma pessoa é majoritariamente DELA —
        // 40% aqui — e é o tamanho dessa parte que decide o custo da regravação.
        ...(i % 10 < 6
          ? { origem: 'catalogo' as const }
          : {
              remoteUrl: `https://importer.exemplo.test/blob/${id}`,
              sourceUrl: `https://www.youtube.com/watch?v=seed${i}`,
              contentHash: `hash-${i}`,
            }),
      };
    });

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aurial-registro', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('biblioteca')) db.createObjectStore('biblioteca');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('biblioteca', 'readwrite');
        tx.objectStore('biblioteca').put(entradas, 'entradas');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, quantas);
}

/**
 * Corta a rede: mede-se o cliente, não a internet do momento.
 *
 * MESMA ORIGEM NÃO BASTA como critério. A primeira versão deste filtro liberava
 * tudo em `localhost:4173`, e a API entra por AÍ — `/api/v1/...` é servido pelo
 * proxy do Vite, que repassa para o servidor de verdade. Resultado: as chamadas
 * escapavam, morriam em ECONNREFUSED depois de um tempo variável, e esse tempo
 * entrava na medição. O número virava metade produto, metade rede.
 *
 * Agora só passa o que o próprio `dist` serve — documento, assets, ícones e o
 * service worker. Todo o resto é abortado NA HORA, o que é determinístico: o
 * app trata a falha pelo mesmo caminho de quando está offline.
 */
const CAMINHOS_ESTATICOS = /^\/(assets\/|icons\/|fonts\/|manifest|favicon|sw\.js|workbox|$)/;

export async function isolarDaRede(page: Page): Promise<void> {
  await page.route('**/*', (rota) => {
    const url = new URL(rota.request().url());
    const local = url.host === 'localhost:4173';
    if (local && CAMINHOS_ESTATICOS.test(url.pathname)) return rota.continue();
    // Rotas do SPA (/, /search…) também são documento servido pelo dist.
    if (local && rota.request().resourceType() === 'document') return rota.continue();
    return rota.abort();
  });
}
