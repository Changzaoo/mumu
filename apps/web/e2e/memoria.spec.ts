/// <reference lib="dom" />
//
// Os tipos de DOM entram SÓ NESTE ARQUIVO (mesmo motivo de `desempenho.spec.ts`):
// o tsconfig da pasta `e2e` é de Node, e os corpos de `evaluate`/`addInitScript`
// abaixo são os únicos trechos que realmente executam no navegador.
/**
 * QUANTA RAM A ABA SEGURA PARADA — medido, não deduzido.
 *
 * O relato foi "passa de 1,4 GB só com a aba do radinho aberta". O arnês de
 * desempenho não enxerga isso: ele mede TRAVAMENTO (quanto tempo a thread
 * principal ficou presa), e uma aba pode abrir fluida e mesmo assim terminar
 * segurando um giga. São dois eixos, e faltava o segundo.
 *
 * ── DE ONDE VEM A MEMÓRIA DE UM APP DE MÚSICA ──
 *
 * Quase nada dela é objeto de JavaScript. As três fontes reais são:
 *
 *  1. ALÇAS DE BLOB (`URL.createObjectURL`). Não são endereços: cada uma segura
 *     o arquivo INTEIRO vivo até alguém soltar. `performance.memory` não conta
 *     um byte disso — os bytes moram no processo do navegador, não no heap de
 *     JS. É por isso que "o heap está em 80 MB" convive com "a aba está em
 *     1,4 GB", e é por isso que este arnês não confia no heap.
 *  2. IMAGENS DECODIFICADAS. Uma capa de 600×600 ocupa ~1,4 MB de bitmap
 *     depois de decodificada, independente de quantos KB tinha o JPEG.
 *  3. O heap de JS propriamente dito — na prática, a menor das três.
 *
 * ── COMO SE MEDE A PRIMEIRA (que é a que não tem API) ──
 *
 * Trocando `URL.createObjectURL`/`revokeObjectURL` por versões que anotam o
 * tamanho do blob de cada alça aberta e riscam a anotação quando alguém solta.
 * A troca acontece em `addInitScript`, ANTES de qualquer código do app rodar, e
 * o que sobra no fim é exatamente o conjunto de arquivos que a aba está
 * segurando vivo. Funciona sobre o app sem modificação nenhuma — é medida de
 * fora, não instrumentação de dentro.
 *
 * ── O QUE ESTE ARNÊS SEMEIA, E POR QUE DIFERENTE DO OUTRO ──
 *
 * `desempenho.spec.ts` semeia uma capa de CDN em nove de cada dez faixas, de
 * propósito: lá a pergunta é o custo de ir ao disco, e capa http:// não vai.
 * Aqui é o contrário. A biblioteca que o relato descreve é IMPORTADA de
 * arquivos locais, e nela toda capa é embutida no MP3: o registro guarda
 * `coverUrl: null` (a imagem não caberia no localStorage) e a arte mora no
 * IndexedDB. Semear capa de CDN aqui mediria uma biblioteca que a pessoa não
 * tem, e o número voltaria bonito por construção.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';

/** Tamanhos de biblioteca. 5.000 é a ordem de grandeza do acervo real. */
const BIBLIOTECAS = [1_000, 5_000] as const;

/** Quanto esperar depois do `load` para os plantões de fundo assentarem. */
const ASSENTAR_MS = 12_000;

/**
 * Lado da capa embutida semeada. O peso resultante (~210 KB) é conferido pelo
 * próprio teste de convergência, que reprova se a semente nascer magra.
 *
 * O que decide o peso não é o lado, e sim o DESENHO — ver o comentário sobre
 * grão em `semear`, que é onde mora a diferença entre uma capa que representa
 * o problema e uma que o esconde.
 */
/**
 * TETO DE ARTE EMBUTIDA SEMEADA — um limite do arnês, não do produto.
 *
 * A capa semeada pesa ~210 KB, que é o peso de arte de MP3 real. Dar arte a
 * 5.000 faixas seria escrever mais de 1 GB no IndexedDB de uma página só, e o
 * renderer morria durante a semeadura — a medição nunca chegava a acontecer.
 *
 * Mil e quinhentas capas já são várias vezes o que o orçamento de memória
 * consegue segurar, que é exatamente o que este arnês precisa provar. As faixas
 * acima do teto ficam com capa de CDN — uma URL http comum, que não segura byte
 * nenhum. Biblioteca de verdade é mista assim.
 */
const MAXIMO_DE_ARTE_EMBUTIDA = 1_500;

const LADO_DA_CAPA = 600;

interface Alcas {
  n: number;
  bytes: number;
  porTipo: Record<string, { n: number; bytes: number }>;
}

interface Medida {
  faixas: number;
  /**
   * Quanto a thread principal ficou presa (TBT) NESTA abertura.
   *
   * Anda junto com a memória de propósito. O conserto que encolhe as capas
   * gastar CPU decodificando e recodificando imagem, e um arnês que só olhasse
   * memória daria "melhorou" a uma troca de memória por travamento — que é o
   * erro que este projeto já cometeu antes e que `desempenho.spec.ts` existe
   * para reprovar. Aqui o número fica ao lado do outro, no MESMO cenário: com
   * capa embutida, que é quando a conversão de fato roda.
   */
  bloqueioMs: number;
  /** A memória parou de subir dentro do teto? Se não, o número é piso, não patamar. */
  assentou: boolean;
  alcasN: number;
  alcasMb: number;
  heapMb: number | null;
  nos: number;
  imagensMb: number;
  totalMb: number;
  porTipo: Record<string, { n: number; bytes: number }>;
}

/**
 * Anota o tamanho de cada alça de blob aberta e risca a anotação quando alguém
 * solta. Precisa rodar antes do app — daí `addInitScript`.
 *
 * O tipo MIME entra junto porque "1,1 GB de alças" não é diagnóstico: a mesma
 * soma pode ser áudio que se está ouvindo (legítimo) ou capa parada (não).
 * Separado por tipo, o relatório aponta o dono.
 */
async function espionarAlcas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const vivas = new Map<string, { bytes: number; tipo: string }>();
    const criar = URL.createObjectURL.bind(URL);
    const soltar = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      const url = criar(obj as Blob);
      if (obj instanceof Blob) {
        vivas.set(url, {
          bytes: obj.size,
          tipo: (obj.type || 'desconhecido').split(';')[0] ?? 'desconhecido',
        });
      }
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      vivas.delete(url);
      soltar(url);
    };

    (window as unknown as { __alcasVivas: () => unknown }).__alcasVivas = () => {
      const porTipo: Record<string, { n: number; bytes: number }> = {};
      let bytes = 0;
      for (const alca of vivas.values()) {
        bytes += alca.bytes;
        const balde = (porTipo[alca.tipo] ??= { n: 0, bytes: 0 });
        balde.n += 1;
        balde.bytes += alca.bytes;
      }
      return { n: vivas.size, bytes, porTipo };
    };
  });
}

/**
 * Caminho sentinela servido pelo próprio arnês: uma página VAZIA na mesma
 * origem do app.
 *
 * Existe porque semear com o app rodando não funciona. O IndexedDB é por
 * origem, então a semeadura precisa acontecer em `localhost:4173` — mas se ela
 * acontecer sobre o app, o app está vivo enquanto ela dura: o service worker
 * assume a aba e RECARREGA a página no meio (ver `pwa.ts`, `controllerchange`),
 * e a semeadura morre com "execution context was destroyed". Foi exatamente o
 * que derrubou a primeira versão deste arnês.
 *
 * Uma página em branco na mesma origem resolve os dois lados: mesmo cofre,
 * nenhum código do app rodando. Depois dela, `goto('/')` boota o app já com a
 * biblioteca cheia — que é o cenário que se quer medir.
 */
const PAGINA_DE_SEMEADURA = '/__semeadura__';

/**
 * Semeia N entradas no registro (IndexedDB) MAIS a arte embutida de cada uma.
 *
 * A arte é um JPEG de verdade, gerado no canvas com ruído — não um Blob de
 * bytes aleatórios. A diferença importa: só imagem decodificável entra na conta
 * de bitmap do navegador, que é a segunda maior fonte de memória aqui. Um blob
 * falso mediria a alça e perderia a decodificação.
 */
interface Semeadura {
  capaBytes: number;
  capasGravadas: number;
  usoMb: number | null;
  cotaMb: number | null;
}

async function semear(
  page: Page,
  quantas: number,
  opcoes: { todasDoUsuario?: boolean } = {},
): Promise<Semeadura> {
  await page.goto(PAGINA_DE_SEMEADURA);
  return await page.evaluate(
    async ({
      n,
      lado,
      todasDoUsuario,
      comArte,
    }: {
      n: number;
      lado: number;
      todasDoUsuario: boolean;
      comArte: number;
    }) => {
      // ── a capa, uma vez, reaproveitada em todas as chaves ──
      const canvas = document.createElement('canvas');
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('sem canvas 2d');
      // ARTE ABSTRATA, e nem gradiente nem ruído — os dois extremos mentem.
      //
      // Gradiente puro comprime a quase nada: a capa semeada sairia dez vezes
      // menor que a arte de um MP3 real e o problema não apareceria.
      //
      // Ruído puro mente do outro lado, e foi o erro da primeira versão deste
      // arnês: dá o peso certo, mas ruído é INCOMPRESSÍVEL — encolher para 320px
      // não devolvia bytes, e o teste de convergência reprovou o app por um
      // defeito que era da semeadura. Nenhuma capa de verdade se comporta assim.
      //
      // Formas sobrepostas têm as duas propriedades da arte real: detalhe
      // suficiente para pesar em 600px, e estrutura suficiente para encolher de
      // verdade em 320px.
      const grad = ctx.createLinearGradient(0, 0, lado, lado);
      grad.addColorStop(0, `hsl(${Math.random() * 360}, 70%, 45%)`);
      grad.addColorStop(1, `hsl(${Math.random() * 360}, 70%, 20%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, lado, lado);
      for (let i = 0; i < 2200; i += 1) {
        ctx.fillStyle = `hsla(${Math.random() * 360}, ${40 + Math.random() * 60}%, ${
          20 + Math.random() * 60
        }%, ${0.15 + Math.random() * 0.5})`;
        ctx.beginPath();
        if (i % 3 === 0) {
          ctx.arc(Math.random() * lado, Math.random() * lado, Math.random() * lado * 0.12, 0, 7);
          ctx.fill();
        } else {
          ctx.fillRect(
            Math.random() * lado,
            Math.random() * lado,
            Math.random() * lado * 0.2,
            Math.random() * lado * 0.2,
          );
        }
      }
      // GRÃO POR CIMA, e é ele que dá o peso.
      //
      // Só formas sobrepostas ficam lisas demais: o JPEG a 1000px saiu com 72 KB,
      // abaixo do limiar do app, e a premissa do teste de convergência ruiu
      // (está conferida lá). Arte de verdade — foto, scan de capa, textura — tem
      // grão de alta frequência, e é esse grão que faz um JPEG grande pesar
      // centenas de KB. Ele some no reescalonamento para 320px, que é
      // exatamente por que a miniatura ganha tanto.
      const grao = document.createElement('canvas');
      grao.width = lado;
      grao.height = lado;
      const gctx = grao.getContext('2d');
      if (gctx) {
        const ruido = gctx.createImageData(lado, lado);
        for (let i = 0; i < ruido.data.length; i += 4) {
          const v = Math.random() * 255;
          ruido.data[i] = v;
          ruido.data[i + 1] = v;
          ruido.data[i + 2] = v;
          ruido.data[i + 3] = 255;
        }
        gctx.putImageData(ruido, 0, 0);
        ctx.globalAlpha = 0.35;
        ctx.drawImage(grao, 0, 0);
        ctx.globalAlpha = 1;
      }

      const capa = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob falhou'))),
          'image/jpeg',
          0.92,
        );
      });

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
            genre: i % 3 === 0 ? null : ['Pop', 'Rock', 'Samba', 'K-Pop'][i % 4],
            // Capa embutida = `null` aqui, arte no IndexedDB (é assim que uma
            // biblioteca importada de arquivos locais fica). Acima do teto do
            // arnês a faixa ganha capa de CDN, que não segura byte nenhum.
            coverUrl: i < comArte ? null : `https://cdn.exemplo.test/capa/${i % 400}.jpg`,
            streamUrl: null,
            uploadedByUserId: null,
          },
          addedAt: new Date(Date.now() - i * 60_000).toISOString(),
          sizeBytes: 8_000_000,
          mimeType: 'audio/mpeg',
          tocavel: true,
          ...(!todasDoUsuario && i % 10 < 6
            ? { origem: 'catalogo' as const }
            : {
                remoteUrl: `https://importer.exemplo.test/blob/${id}`,
                sourceUrl: `https://www.youtube.com/watch?v=seed${i}`,
                contentHash: `hash-${i}`,
              }),
        };
      });

      const abrir = (nome: string, versao: number, loja: string): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open(nome, versao);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(loja)) db.createObjectStore(loja);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

      const registro = await abrir('aurial-registro', 1, 'biblioteca');
      await new Promise<void>((resolve, reject) => {
        const tx = registro.transaction('biblioteca', 'readwrite');
        tx.objectStore('biblioteca').put(entradas, 'entradas');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // A arte vai para `aurial-offline`, loja `audio`, sob `cover:<id>` — as
      // mesmas coordenadas de `putCover`. Em lotes porque uma transação com
      // 5.000 puts de 300 KB estoura o tempo da própria transação.
      const offline = await abrir('aurial-offline', 1, 'audio');
      // Lotes pequenos: 250 puts de 210 KB numa transação só fazem o renderer
      // segurar dezenas de MB de uma vez, e o custo se acumula lote a lote.
      for (let inicio = 0; inicio < comArte; inicio += 100) {
        const fim = Math.min(inicio + 100, comArte);
        await new Promise<void>((resolve, reject) => {
          const tx = offline.transaction('audio', 'readwrite');
          const loja = tx.objectStore('audio');
          for (let i = inicio; i < fim; i += 1) loja.put(capa, `cover:local:seed-${i}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }

      // CONFERÊNCIA REAL, e não suposição de que o put pegou.
      //
      // Semear 5.000 capas escreve centenas de MB, e sob pressão de cota o
      // navegador aceita a transação e despeja a entrada depois. Sem reler as
      // chaves, uma semeadura pela metade vira "o app não segurou memória
      // nenhuma" — que foi exatamente o resultado bonito e falso que este arnês
      // reportou para 5.000 faixas antes desta conferência existir.
      const chaves = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = offline.transaction('audio', 'readonly');
        const req = tx.objectStore('audio').getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const capasGravadas = chaves.filter(
        (k) => typeof k === 'string' && k.startsWith('cover:'),
      ).length;

      const cota = await navigator.storage?.estimate?.().catch(() => null);
      return {
        capaBytes: capa.size,
        capasGravadas,
        usoMb: cota?.usage ? Math.round(cota.usage / 1e6) : null,
        cotaMb: cota?.quota ? Math.round(cota.quota / 1e6) : null,
      };
    },
    {
      n: quantas,
      lado: LADO_DA_CAPA,
      todasDoUsuario: opcoes.todasDoUsuario ?? false,
      comArte: Math.min(quantas, MAXIMO_DE_ARTE_EMBUTIDA),
    },
  );
}

/**
 * Corta a rede: mede-se o cliente, não a internet do momento. Idêntico ao do
 * arnês de desempenho, e pelo mesmo motivo (ver lá).
 */
const CAMINHOS_ESTATICOS = /^\/(assets\/|icons\/|fonts\/|manifest|favicon|workbox|$)/;

async function isolarDaRede(page: Page): Promise<void> {
  await page.route('**/*', (rota) => {
    const url = new URL(rota.request().url());
    const local = url.host === 'localhost:4173';

    // A página em branco onde a semeadura roda. Servida daqui, e não pelo
    // `dist`, para não depender de nada do produto.
    if (local && url.pathname === PAGINA_DE_SEMEADURA) {
      return rota.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><meta charset="utf-8"><title>semeadura</title>',
      });
    }

    // O SERVICE WORKER FICA DE FORA — e não é economia, é a medição.
    //
    // O worker deste app é `autoUpdate`: assume as abas e RECARREGA a página
    // (ver `pwa.ts`). No meio de uma medição de 12 segundos isso zera as alças
    // e o número volta bonito por acidente. O que o SW faz — servir o bundle de
    // cache — não muda a memória retida, que é o que se mede aqui.
    if (local && url.pathname === '/sw.js') return rota.abort();

    if (local && CAMINHOS_ESTATICOS.test(url.pathname)) return rota.continue();
    if (local && rota.request().resourceType() === 'document') return rota.continue();
    return rota.abort();
  });
}

/** Lê o espião de alças que `espionarAlcas` instalou. */
async function lerAlcas(page: Page): Promise<Alcas> {
  return (await page.evaluate(() => {
    const w = window as unknown as { __alcasVivas?: () => unknown };
    return w.__alcasVivas?.() ?? { n: 0, bytes: 0, porTipo: {} };
  })) as Alcas;
}

/**
 * Espera a memória PARAR DE SUBIR — não um relógio fixo.
 *
 * A primeira versão esperava 12 segundos cravados e mediu 135 alças numa
 * biblioteca de 1.000 faixas. O número não era o patamar: era onde a subida
 * estava quando o cronômetro tocou. Um arnês que devolve um valor de meio
 * caminho é pior que nenhum — responde com confiança à pergunta errada, e a
 * otimização seguinte é escolhida contra um alvo que não existe.
 *
 * A SEGUNDA versão errou do outro lado, e o erro é mais traiçoeiro: ela aceitou
 * "três leituras iguais" quando as três eram ZERO. Numa biblioteca de 5.000
 * faixas a restauração de capas demora a produzir a primeira alça, e o arnês
 * declarou assentado um app que ainda não tinha começado — relatando 0 MB para
 * o caso mais pesado da suíte. Zero parado no começo é indistinguível de zero
 * parado no fim SE só se olha a série; o que os separa é ter havido subida.
 *
 * Daí as duas condições: um PISO de tempo que todo mundo cumpre, e — enquanto
 * nada tiver sido aberto ainda — um piso maior, porque "nada aconteceu" só é
 * conclusão depois de esperar de verdade.
 */
async function esperarAssentar(page: Page): Promise<boolean> {
  const PASSO_MS = 3_000;
  // Cinco leituras (15s sem crescer). Três eram pouco: numa biblioteca de 5.000
  // faixas a restauração sobe aos trancos, e uma pausa de 6s entre trancos
  // passava por patamar.
  const PARADAS_PARA_ASSENTAR = 5;
  /** Ninguém assenta antes disto: os plantões de fundo nem acordaram. */
  const PISO_MS = 30_000;
  /** Piso maior enquanto nada foi aberto — ver o segundo erro no cabeçalho. */
  const PISO_SEM_NADA_MS = 90_000;
  const TETO_MS = 300_000;

  const inicio = Date.now();
  let anterior = -1;
  let paradas = 0;
  let jaAbriuAlguma = false;

  while (Date.now() - inicio < TETO_MS) {
    await page.waitForTimeout(PASSO_MS);
    const { n } = await lerAlcas(page);
    if (n > 0) jaAbriuAlguma = true;
    paradas = n === anterior ? paradas + 1 : 0;
    anterior = n;

    const decorrido = Date.now() - inicio;
    const piso = jaAbriuAlguma ? PISO_MS : PISO_SEM_NADA_MS;
    if (paradas >= PARADAS_PARA_ASSENTAR && decorrido >= piso) return true;
  }
  return false;
}

async function medir(page: Page, cdp: CDPSession, faixas: number): Promise<Medida> {
  const semeadura = await semear(page, faixas);
  // eslint-disable-next-line no-console -- é a saída do arnês
  console.log(
    `  (semeadura: ${Math.round(semeadura.capaBytes / 1024)} KB × ${semeadura.capasGravadas}` +
      ` capas de ${faixas} · disco ${semeadura.usoMb ?? '—'}/${semeadura.cotaMb ?? '—'} MB)`,
  );
  // Semeadura incompleta invalida a medida: o app não tem como segurar o que
  // não foi gravado, e o número sairia bonito por acidente.
  expect(semeadura.capasGravadas, 'toda capa semeada precisa ter sido gravada').toBe(
    Math.min(faixas, MAXIMO_DE_ARTE_EMBUTIDA),
  );

  // Só AGORA o app sobe, e sobe já com a biblioteca cheia — que é o boot que a
  // pessoa vive todo dia, e o único em que a memória tem do que se encher.
  await page.goto('/', { waitUntil: 'load' });
  const assentou = await esperarAssentar(page);

  // Uma coleta forçada antes de ler o heap: sem isso o número inclui lixo que o
  // navegador ainda não recolheu, e a comparação antes/depois viraria ruído.
  await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);

  const alcas = await lerAlcas(page);

  const heapMb = await page.evaluate(() => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof m?.usedJSHeapSize === 'number' ? Math.round(m.usedJSHeapSize / 1e6) : null;
  });

  // Bitmap das imagens que estão no DOM AGORA. `naturalWidth` é o tamanho real
  // do arquivo, não o exibido — e é ele que decide o custo da decodificação.
  const imagensBytes = await page.evaluate(() => {
    let total = 0;
    for (const img of Array.from(document.images)) {
      if (img.naturalWidth > 0) total += img.naturalWidth * img.naturalHeight * 4;
    }
    return total;
  });

  const bloqueioMs = await page.evaluate(() => {
    const w = window as unknown as { radinhoPerfDados?: () => { bloqueioTotalMs?: number } };
    return w.radinhoPerfDados?.().bloqueioTotalMs ?? -1;
  });

  const contadores = (await cdp.send('Memory.getDOMCounters').catch(() => ({ nodes: -1 }))) as {
    nodes: number;
  };

  const alcasMb = Math.round(alcas.bytes / 1e6);
  const imagensMb = Math.round(imagensBytes / 1e6);
  return {
    faixas,
    bloqueioMs,
    assentou,
    alcasN: alcas.n,
    alcasMb,
    heapMb,
    nos: contadores.nodes,
    imagensMb,
    totalMb: alcasMb + imagensMb + (heapMb ?? 0),
    porTipo: alcas.porTipo,
  };
}

/** Quantas capas guardadas ainda estão em tamanho de gravadora. */
async function capasGordas(
  page: Page,
  limiar: number,
): Promise<{ total: number; gordas: number; mediaKb: number }> {
  return await page.evaluate(async (limite: number) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('aurial-offline', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tudo = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction('audio', 'readonly');
      const req = tx.objectStore('audio').getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    const capas = tudo.filter((v): v is Blob => v instanceof Blob && v.type.startsWith('image/'));
    const soma = capas.reduce((a, b) => a + b.size, 0);
    return {
      total: capas.length,
      gordas: capas.filter((b) => b.size > limite).length,
      mediaKb: capas.length ? Math.round(soma / capas.length / 1024) : 0,
    };
  }, limiar);
}

/**
 * A BIBLIOTECA ANTIGA TEM DE CONVERGIR — senão o teto é só um curativo.
 *
 * O teto de bytes segura a memória na primeira abertura despejando capas, e
 * despejar significa faixa sem capa na tela. Isso seria aceitável uma vez e
 * inaceitável para sempre: uma biblioteca que passa a eternidade batendo no
 * teto é uma biblioteca em que as capas piscam.
 *
 * O conserto de verdade é a arte ENCOLHIDA e regravada, um punhado por boot
 * (encolher 5.000 de uma vez trocaria memória por travamento). Este teste é o
 * que separa as duas coisas: se a média em disco não cair a cada abertura, a
 * conversão não está persistindo e o app está refazendo o mesmo trabalho para
 * sempre — que é pior que não fazer.
 */
test.describe('a biblioteca antiga converge para miniatura', () => {
  test('cada abertura deixa menos capa gorda em disco', async ({ page }) => {
    test.setTimeout(9 * 60_000);
    await espionarAlcas(page);
    await isolarDaRede(page);

    const FAIXAS = 600;
    const LIMIAR_DE_GORDA = 60_000; // o `BYTES_QUE_JA_ESTAO_BONS` do app
    // TUDO DO USUÁRIO AQUI, e a mistura do outro teste seria errada nesta
    // pergunta — custou uma investigação descobrir.
    //
    // Faixa do ACERVO não é persistida no registro local: ela volta do servidor
    // a cada boot (ver `carregarRegistro`). Como este arnês corta a rede de
    // propósito, as faixas de acervo somem depois da primeira abertura e as
    // capas delas viram órfãs no disco — arte guardada sem faixa que a reclame.
    // A conversão parava em 270 e parecia um app travado; eram exatamente as
    // órfãs do acervo, inalcançáveis por qualquer varredura da BIBLIOTECA.
    //
    // A pergunta deste teste é se a biblioteca DA PESSOA converge, então é dela
    // que a semeadura é feita.
    const semeadura = await semear(page, FAIXAS, { todasDoUsuario: true });

    // A PREMISSA DO TESTE, CONFERIDA E NÃO SUPOSTA.
    //
    // Se a capa semeada já nascer magra, não há o que converter: o teste passa
    // (ou falha) por um motivo que nada tem a ver com o app. Aconteceu — uma
    // afinação no desenho da arte deixou a semente abaixo do limiar e o
    // resultado virou ruído. A premissa agora quebra alto.
    expect(
      semeadura.capaBytes,
      'a capa semeada precisa nascer GORDA, senão não há conversão a medir',
    ).toBeGreaterThan(LIMIAR_DE_GORDA * 2);

    const trajetoria: {
      boot: number;
      total: number;
      gordas: number;
      mediaKb: number;
      alcasMb: number;
    }[] = [];
    for (let boot = 1; boot <= 5; boot += 1) {
      await page.goto('/', { waitUntil: 'load' });

      // ESPERA A CONVERSÃO, NÃO AS ALÇAS.
      //
      // `esperarAssentar` observa o número de alças, e nas primeiras aberturas
      // isso serve: elas fervem de despejo enquanto as capas gordas enchem o
      // orçamento. Nas últimas não serve mais — com quase tudo já em miniatura
      // a contagem estabiliza depressa e a medição acontecia COM A CONVERSÃO
      // AINDA RODANDO, o que fazia a trajetória parecer travada num número.
      //
      // Aqui se observa a coisa medida: o disco. Quando ele para de encolher, a
      // passada daquela abertura acabou.
      let gordas = Number.POSITIVE_INFINITY;
      let mediaKb = 0;
      let total = 0;
      let paradas = 0;
      const limite = Date.now() + 150_000;
      while (Date.now() < limite && paradas < 2) {
        await page.waitForTimeout(3_000);
        const agora = await capasGordas(page, LIMIAR_DE_GORDA);
        paradas = agora.gordas === gordas ? paradas + 1 : 0;
        gordas = agora.gordas;
        mediaKb = agora.mediaKb;
        total = agora.total;
      }

      const alcas = await lerAlcas(page);
      trajetoria.push({ boot, total, gordas, mediaKb, alcasMb: Math.round(alcas.bytes / 1e6) });
    }

    // eslint-disable-next-line no-console -- é a saída do arnês
    console.log(`
  conversão das capas antigas (${FAIXAS} faixas)`);
    // eslint-disable-next-line no-console -- é a saída do arnês
    console.table(trajetoria);

    const primeiro = trajetoria.at(0);
    const ultimo = trajetoria.at(-1);
    if (!primeiro || !ultimo) throw new Error('trajetória vazia');

    // O disco tem de encolher de verdade. Se a média não cair, a regravação
    // não está acontecendo e cada boot refaz a mesma conversão em vão.
    expect(ultimo.gordas, 'sobrou capa gorda depois de cinco aberturas').toBeLessThan(
      primeiro.gordas,
    );
    expect(ultimo.mediaKb, 'a capa média em disco precisa encolher').toBeLessThan(primeiro.mediaKb);
    // E o ponto de chegada: com tudo em miniatura, a biblioteca inteira cabe no
    // orçamento e nenhuma capa precisa mais ser despejada.
    expect(ultimo.gordas, 'a conversão precisa terminar, não só progredir').toBe(0);
  });
});

test.describe('memória retida com a aba aberta', () => {
  const medidas: Medida[] = [];

  for (const faixas of BIBLIOTECAS) {
    test(`biblioteca de ${faixas} faixas`, async ({ page }) => {
      await espionarAlcas(page);
      await isolarDaRede(page);
      const cdp = await page.context().newCDPSession(page);
      const m = await medir(page, cdp, faixas);
      medidas.push(m);

      const porTipo = Object.entries(m.porTipo)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(
          ([tipo, v]) =>
            `        ${tipo.padEnd(16)} ${String(v.n).padStart(5)} alças  ${Math.round(v.bytes / 1e6)} MB`,
        )
        .join('\n');

      // eslint-disable-next-line no-console -- é a saída do arnês
      console.log(
        `\n  ${m.faixas} faixas — parada, sem tocar nada\n` +
          `    alças de blob:    ${m.alcasN} abertas, ${m.alcasMb} MB presos\n` +
          `${porTipo}\n` +
          `    heap de JS:       ${m.heapMb ?? '—'} MB\n` +
          `    imagens no DOM:   ${m.imagensMb} MB de bitmap\n` +
          `    nós do DOM:       ${m.nos}\n` +
          `    travamento (TBT): ${m.bloqueioMs} ms
` +
          `    ── total medido:  ${m.totalMb} MB\n`,
      );

      // O instrumento tem de ter respondido. Espião mudo devolveria 0 alças e a
      // suíte passaria medindo nada — que é pior que não medir.
      expect(m.heapMb, 'o heap precisa ser legível (--enable-precise-memory-info)').not.toBeNull();
    });
  }

  test.afterAll(() => {
    if (medidas.length === 0) return;
    // eslint-disable-next-line no-console -- é a saída do arnês
    console.log('\n\n===== RESUMO: memória retida com a aba parada =====');
    // eslint-disable-next-line no-console -- é a saída do arnês
    console.table(
      medidas.map((m) => ({
        faixas: m.faixas,
        assentou: m.assentou,
        'alças (n)': m.alcasN,
        'alças (MB)': m.alcasMb,
        'heap (MB)': m.heapMb,
        'TBT (ms)': m.bloqueioMs,
        'bitmap (MB)': m.imagensMb,
        'nós DOM': m.nos,
        'TOTAL (MB)': m.totalMb,
      })),
    );
  });
});
