/**
 * O ACERVO no Postgres — a leitura que saiu do Firestore.
 *
 * Por que saiu: a coleção INTEIRA era lida a cada abertura do app, por cada
 * pessoa, mais a varredura horária do worker. O limite grátis de 50 mil
 * leituras/dia é do PROJETO, então quando ele estourava caía tudo junto —
 * acervo, sincronia entre aparelhos, curtidas. Aconteceu três vezes.
 *
 * Aqui não há pedágio por leitura. E a máquina que serve isto já é dependência
 * dura para tocar (todo áudio sai dela), então a listagem vir daqui não cria
 * nenhum ponto de falha novo.
 */
import { prisma } from '../../infra/db/prisma.js';

/** A entrada como o cliente a conhece — trafega inteira, sem tradução. */
export type CatalogEntry = Record<string, unknown>;

export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** Identidade do conteúdo, para o `If-None-Match` do cliente. */
  etag: string;
}

/**
 * A assinatura do acervo sem ler o acervo.
 *
 * `count` pega remoção e inclusão; `max(updatedAt)` pega edição. Juntos
 * descrevem qualquer mudança, e as duas saem de uma agregação que o índice de
 * `updatedAt` resolve na hora — muito mais barato que serializar centenas de
 * faixas para descobrir que nada mudou.
 */
export async function catalogEtag(): Promise<string> {
  const agg = await prisma.catalogTrack.aggregate({
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const carimbo = agg._max.updatedAt?.getTime() ?? 0;
  return `W/"${agg._count._all}-${carimbo}"`;
}

/**
 * CAMPOS QUE SÃO SÓ DO SERVIDOR — não descem para o cliente, e o cliente não
 * pode apagá-los.
 *
 * `dna` é o vetor semântico de 2048 dimensões que a curadoria grava para
 * comparar faixas. Medido no acervo em 2026-08-30: só 266 das 5.053 entradas
 * têm o vetor, e essas 266 sozinhas eram **10,01 MB de 15,69 MB — 71% do peso
 * de todos os campos somados**. Cada vetor ocupa ~39 KB escrito como JSON.
 *
 * E o app nunca leu isso: não há UMA referência a `dna` em `apps/web/src`. Era
 * download, `JSON.parse` e gravação em IndexedDB de dez megabytes que ninguém
 * abria — no celular modesto, o pico de memória e o tempo de parse que atrasam
 * a primeira faixa aparecer.
 *
 * Tirar da LISTAGEM não pode virar apagar do BANCO: o cliente republica faixas
 * (`PUT /catalogo/:id`, `POST /bulk`) e a gravação substitui o documento
 * inteiro. Sem a preservação abaixo, a primeira republicação zeraria o vetor de
 * volta — a curadoria refaria, o cliente apagaria de novo, para sempre.
 */
const CAMPOS_DO_SERVIDOR = ['dna'] as const;

/**
 * PESO MORTO DENTRO DA FAIXA — campos que descem para todo aparelho e que
 * ninguém lê.
 *
 * Contados no acervo em 2026-08-30, um a um, sobre as 5.054 entradas: cada um
 * destes tem ZERO valores úteis. Não "poucos": nenhum. São restos do formato da
 * API central, que este app não usa — ele monta álbum, artista e gênero a
 * partir da metadata local.
 *
 * O peso em bytes é modesto, ~179 kB, e não é por ele que isto existe. É pela
 * CONTAGEM: nove campos × 5.054 faixas são 45 mil propriedades que o navegador
 * do celular precisa alocar, indexar e manter vivas para nada. No heap, cada
 * propriedade custa muito mais que os poucos bytes do seu texto em JSON.
 */
const CAMPOS_MORTOS_DA_FAIXA = [
  'explicit',
  'uploadedByUserId',
  'dominantColor',
  'trackNumber',
  'discNumber',
  'loudnessLufs',
  'downloadUrl',
  'releaseYear',
  'playsCount',
] as const;

/**
 * IDENTIDADE QUE NÃO IDENTIFICA NADA AQUI.
 *
 * `album.id`, `album.slug`, `artists[].id` e `artists[].slug` não têm UMA
 * leitura no app inteiro — conferido campo a campo. Este app navega álbum por
 * chave (`titulo|artista`, ver `albumKeyForTrack`) e artista por nome
 * (`/artista/:name`); os ids são de uma API central que não está no ar, e
 * mandá-los para `/album/:id` levaria a pessoa a uma página de erro.
 *
 * `album.coverUrl` sai por outro motivo: é duplicata. O grupo de álbum que a
 * tela mostra tira a capa da PRÓPRIA FAIXA (`if (!album.coverUrl && t.coverUrl)`
 * em localLibrary), então esta cópia desce 440 kB para ser ignorada.
 *
 * `artists[].imageUrl` é sempre nulo: a foto real do artista é buscada à parte
 * e cacheada (ver `lib/artistImage`).
 *
 * Juntos: ~956 kB e mais 30 mil propriedades.
 */
const CAMPOS_MORTOS_DO_ALBUM = ['id', 'slug', 'coverUrl'] as const;
const CAMPOS_MORTOS_DO_ARTISTA = ['id', 'slug', 'imageUrl', 'order'] as const;

/**
 * O QUE SÓ FAZ SENTIDO NO CLIQUE — e por que ele saiu da listagem.
 *
 * Estes campos existem para UMA faixa de cada vez: a URL de onde sair o som, o
 * link de origem para reimportar, o hash que impede importar duas vezes o mesmo
 * arquivo. Nenhum deles é lido para DESENHAR uma lista — a lista precisa de
 * título, capa, artista, álbum e duração.
 *
 * Mesmo assim, os seis desciam para todo aparelho, multiplicados por 5.054
 * faixas: ~1,5 MB de texto e outras 25 mil propriedades no heap de um celular,
 * para que se usasse, no máximo, algumas dezenas por sessão. Quem ouve vinte
 * músicas carregava cinco mil URLs.
 *
 * Agora eles vêm em `GET /catalogo/:id`, no momento em que alguém realmente vai
 * tocar. Ver `lib/local/detalheDaFaixa.ts` no app.
 */
const CAMPOS_SOB_DEMANDA_DA_ENTRADA = [
  'remoteUrl',
  'sourceUrl',
  'contentHash',
  'mimeType',
  'sizeBytes',
] as const;
const CAMPOS_SOB_DEMANDA_DA_FAIXA = ['streamUrl'] as const;

/**
 * O BOOLEANO QUE SUBSTITUI AS DUAS URLs.
 *
 * Tirar `streamUrl` e `remoteUrl` da listagem quebraria algo que não é
 * cosmético: o app ESCONDE faixa sem cópia (ver `temComoTocar`), porque um
 * card que promete som e responde 404 é pior que um card ausente. Essa decisão
 * era tomada olhando as URLs.
 *
 * `tocavel` carrega exatamente a mesma informação em um bit em vez de duas
 * URLs de ~90 bytes. A porta continua fechando para o que não toca, e a
 * listagem para de carregar o endereço de cinco mil faixas para tocar vinte.
 */
function ehTocavel(entry: Obj): boolean {
  const track = entry.track;
  const stream = track && typeof track === 'object' ? (track as Obj).streamUrl : undefined;
  return Boolean(entry.remoteUrl ?? stream);
}

type Obj = Record<string, unknown>;

/** Devolve o objeto sem os campos pedidos — ou o MESMO objeto, se não havia
 *  nenhum deles. A identidade importa: o acervo fica em cache na memória e
 *  copiar 5 mil objetos sem necessidade é o oposto do que isto busca. */
function sem(obj: Obj, campos: readonly string[]): Obj {
  if (!campos.some((c) => c in obj)) return obj;
  const copia: Obj = { ...obj };
  for (const c of campos) delete copia[c];
  return copia;
}

function enxugarFaixa(track: Obj): Obj {
  let saida = sem(track, [...CAMPOS_MORTOS_DA_FAIXA, ...CAMPOS_SOB_DEMANDA_DA_FAIXA]);

  const album = saida.album;
  if (album && typeof album === 'object') {
    const magro = sem(album as Obj, CAMPOS_MORTOS_DO_ALBUM);
    if (magro !== album) saida = { ...saida, album: magro };
  }

  const artists = saida.artists;
  if (Array.isArray(artists)) {
    let mudou = false;
    const magros = artists.map((a) => {
      if (!a || typeof a !== 'object') return a;
      const m = sem(a as Obj, CAMPOS_MORTOS_DO_ARTISTA);
      if (m !== a) mudou = true;
      return m;
    });
    if (mudou) saida = { ...saida, artists: magros };
  }

  return saida;
}

/**
 * A entrada como a LISTAGEM a entrega: sem o que é só nosso, sem peso morto e
 * sem o que só faz sentido no clique — mais o bit que diz se ela toca.
 */
export function semCamposDoServidor(entry: CatalogEntry): CatalogEntry {
  const tocavel = ehTocavel(entry as Obj);
  let saida = sem(entry as Obj, [...CAMPOS_DO_SERVIDOR, ...CAMPOS_SOB_DEMANDA_DA_ENTRADA]);
  const track = saida.track;
  if (track && typeof track === 'object') {
    const magra = enxugarFaixa(track as Obj);
    if (magra !== track) saida = { ...saida, track: magra };
  }
  // Sempre uma cópia a partir daqui: `saida` pode ainda ser o objeto original
  // quando não havia nada a tirar, e escrever nele contaminaria o cache.
  return { ...saida, tocavel } as CatalogEntry;
}

/**
 * A entrada COMPLETA de uma faixa — o que a listagem deixou de mandar.
 *
 * É este o "quando clicar, aí sim entregar o conteúdo": chega uma faixa por
 * vez, no momento em que alguém vai tocá-la, em vez de cinco mil de uma vez na
 * abertura. O `dna` continua fora (é do servidor), mas a URL da cópia, o link
 * de origem e o resto vêm inteiros.
 */
export async function getCatalogTrack(id: string): Promise<CatalogEntry | null> {
  const linha = await prisma.catalogTrack.findUnique({ where: { id }, select: { data: true } });
  if (!linha) return null;
  return sem(linha.data as Obj, CAMPOS_DO_SERVIDOR) as CatalogEntry;
}

/** A entrada como ela deve ser GRAVADA: o que o cliente mandou, mais o que só
 *  o servidor sabe e que ele não tinha como devolver. */
export function comCamposDoServidor(
  recebida: CatalogEntry,
  anterior: CatalogEntry | null,
): CatalogEntry {
  // `tocavel` é calculado na listagem, não é dado: gravá-lo criaria uma cópia
  // do estado que envelhece sozinha e passa a mentir quando o cofre podar.
  const limpa = sem(recebida as Obj, ['tocavel']) as CatalogEntry;
  if (!anterior) return limpa;
  let saida = limpa;
  for (const campo of [...CAMPOS_DO_SERVIDOR, ...CAMPOS_SOB_DEMANDA_DA_ENTRADA]) {
    if (campo in limpa) continue; // veio preenchido: respeita quem mandou
    if (!(campo in anterior)) continue;
    if (saida === limpa) saida = { ...limpa };
    saida[campo] = anterior[campo];
  }

  // Tirar da LISTAGEM não pode virar apagar do BANCO. O cliente republica
  // faixas e a gravação substitui o documento inteiro: sem esta devolução, a
  // primeira republicação zeraria tudo que foi enxugado acima — e aí seria
  // perda definitiva, não economia.
  const track = (saida as Obj).track;
  const trackAnterior = (anterior as Obj).track;
  if (track && typeof track === 'object' && trackAnterior && typeof trackAnterior === 'object') {
    const devolvida = comOsCamposEnxugados(track as Obj, trackAnterior as Obj);
    if (devolvida !== track) saida = { ...saida, track: devolvida };
  }
  return saida;
}

/** Devolve à faixa recebida o que o enxugamento tinha tirado, lendo do que já
 *  estava gravado. Nunca sobrescreve o que o cliente mandou preenchido. */
function comOsCamposEnxugados(track: Obj, anterior: Obj): Obj {
  let saida = track;
  const repor = (alvo: Obj, fonte: Obj, campos: readonly string[]): Obj => {
    let out = alvo;
    for (const c of campos) {
      if (c in alvo) continue;
      if (!(c in fonte)) continue;
      if (out === alvo) out = { ...alvo };
      out[c] = fonte[c];
    }
    return out;
  };

  saida = repor(saida, anterior, [...CAMPOS_MORTOS_DA_FAIXA, ...CAMPOS_SOB_DEMANDA_DA_FAIXA]);

  const album = saida.album;
  const albumAntes = anterior.album;
  if (album && typeof album === 'object' && albumAntes && typeof albumAntes === 'object') {
    const cheio = repor(album as Obj, albumAntes as Obj, CAMPOS_MORTOS_DO_ALBUM);
    if (cheio !== album) saida = { ...saida, album: cheio };
  }

  const artistas = saida.artists;
  const antes = anterior.artists;
  // POR POSIÇÃO, e só quando as duas listas têm o mesmo tamanho e os mesmos
  // nomes na mesma ordem. Um crédito editado (artista trocado, participação
  // removida) muda essa correspondência, e devolver o id do artista errado
  // seria pior que perder o id: viraria metadata falsa, que ninguém percebe.
  if (Array.isArray(artistas) && Array.isArray(antes) && artistas.length === antes.length) {
    const mesmaOrdem = artistas.every((a, i) => {
      const b = antes[i];
      return (
        a &&
        typeof a === 'object' &&
        b &&
        typeof b === 'object' &&
        (a as Obj).name === (b as Obj).name
      );
    });
    if (mesmaOrdem) {
      let mudou = false;
      const cheios = artistas.map((a, i) => {
        const c = repor(a as Obj, antes[i] as Obj, CAMPOS_MORTOS_DO_ARTISTA);
        if (c !== a) mudou = true;
        return c;
      });
      if (mudou) saida = { ...saida, artists: cheios };
    }
  }

  return saida;
}

/**
 * O ACERVO JÁ MONTADO, guardado em memória enquanto ele não muda.
 *
 * Montar a resposta não é de graça: são 5.053 linhas lidas do Postgres, cada
 * uma com uma coluna JSON que o Prisma desserializa, e depois a limpeza campo a
 * campo. Medido de fora, em produção: **1,5 s até o primeiro byte** — e isso
 * acontecia INTEIRO de novo para cada pessoa que abrisse o app, ainda que nada
 * tivesse mudado no acervo entre uma e outra.
 *
 * A chave do cache é o próprio ETag, que já existia e já é barato de calcular
 * (uma agregação que o índice de `updatedAt` resolve): mesma assinatura, mesma
 * resposta. Qualquer escrita no acervo muda a assinatura e o cache cai sozinho
 * no pedido seguinte — não há invalidação manual para alguém esquecer.
 *
 * Custo: uma cópia do acervo na memória do processo (~6 MB depois que o `dna`
 * saiu). O que ele economiza é justamente o trecho que aparece como app parado,
 * esperando a primeira faixa.
 */
let emMemoria: { etag: string; entries: CatalogEntry[] } | null = null;

export async function listCatalog(): Promise<CatalogSnapshot> {
  const etag = await catalogEtag();
  if (emMemoria?.etag === etag) return { entries: emMemoria.entries, etag };
  const rows = await prisma.catalogTrack.findMany({ orderBy: { updatedAt: 'desc' } });
  const entries = rows.map((r) => semCamposDoServidor(r.data as CatalogEntry));
  emMemoria = { etag, entries };
  return { entries, etag };
}

/** Publica (ou atualiza) uma faixa. O id é o do cliente — ver o schema. */
export async function upsertCatalogTrack(id: string, data: CatalogEntry): Promise<void> {
  const anterior = await prisma.catalogTrack.findUnique({ where: { id }, select: { data: true } });
  const completa = comCamposDoServidor(data, (anterior?.data as CatalogEntry) ?? null);
  await prisma.catalogTrack.upsert({
    where: { id },
    create: { id, data: completa as object },
    update: { data: completa as object },
  });
}

/**
 * Publica várias de uma vez.
 *
 * Existe porque a reconciliação do cliente sobe o que falta — e um aparelho com
 * trezentas faixas faria trezentas requisições, cada uma com ida e volta pelo
 * túnel. Em lote é uma só.
 */
export async function upsertCatalogTracks(
  entradas: Array<{ id: string; data: CatalogEntry }>,
): Promise<number> {
  if (entradas.length === 0) return 0;
  // UMA leitura para o lote inteiro: sem ela, preservar o `dna` custaria uma
  // consulta por faixa e a reconciliação de um aparelho novo (500 por vez)
  // viraria 500 idas ao banco.
  const anteriores = await prisma.catalogTrack.findMany({
    where: { id: { in: entradas.map((e) => e.id) } },
    select: { id: true, data: true },
  });
  const porId = new Map(anteriores.map((a) => [a.id, a.data as CatalogEntry]));
  const completas = entradas.map((e) => ({
    id: e.id,
    data: comCamposDoServidor(e.data, porId.get(e.id) ?? null),
  }));
  await prisma.$transaction(
    completas.map((e) =>
      prisma.catalogTrack.upsert({
        where: { id: e.id },
        create: { id: e.id, data: e.data as object },
        update: { data: e.data as object },
      }),
    ),
  );
  return entradas.length;
}

export async function deleteCatalogTrack(id: string): Promise<void> {
  await prisma.catalogTrack.deleteMany({ where: { id } }); // idempotente
}
