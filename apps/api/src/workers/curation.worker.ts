/**
 * Curadoria de metadata 24/7.
 *
 * O PROBLEMA que ele resolve: os agentes de metadata sempre existiram, mas
 * rodavam no NAVEGADOR — só com o app aberto, doze faixas por sessão, com
 * pausas entre elas. Numa biblioteca de milhares de faixas isso nunca termina,
 * e é por isso que nome de artista errado persiste.
 *
 * COMO ele alcança a biblioteca sem o app aberto: a biblioteca de cada usuário
 * mora em `UserCollectionItem` no NOSSO Postgres. Este worker lê de lá, corrige,
 * e escreve de volta — o `updatedAt` sobe, a sincronia por delta leva a correção
 * para TODOS os aparelhos daquele usuário sozinha. Ninguém precisa abrir nada.
 *
 * ELE LIA DO FIRESTORE, E ISSO PAROU DE FUNCIONAR NA MIGRAÇÃO. A biblioteca saiu
 * do Firestore para o Postgres (ver `serverCollection` no web e o módulo
 * `collections` na API), mas a curadoria continuou lendo e gravando na coleção
 * antiga. O resultado era o pior tipo de defeito: TUDO parecia funcionar — o log
 * mostrava "BENÇA: Sertanejo → Trap", exatamente a correção pedida — e nada
 * chegava na tela, porque o app não lê mais de lá. Um sistema 24/7 consertando
 * uma cópia que ninguém abre.
 *
 * De quebra, cada volta gastava a cota gratuita do Firestore (50 mil leituras
 * por dia, do projeto inteiro) — foi o que derrubou acervo, sincronia e curtidas
 * juntos, três vezes. Aqui a mesma varredura é um `SELECT` indexado e custa nada.
 *
 * SIMULTANEIDADE: os agentes rodam em paralelo através do pool em
 * `infra/ai/nvidia.ts`. As chamadas esperam a rede, não a CPU, então várias em
 * voo ao mesmo tempo cabem numa máquina de 2 núcleos; quem limita é a cota da
 * NVIDIA.
 *
 * PRUDÊNCIA: só sobrescreve quando o auditor diz claramente que está errado
 * (`false`), nunca no "incerto". Escrever palpite por cima de metadata correta
 * é pior que deixar como está.
 */
import {
  aceitarSugestao,
  EMBED_DIMS,
  generoDoArtista,
  lerTituloDeVideo,
  limparNomeDeArtista,
  promoverArtistaReal,
  separarArtistasGrudados,
  revisarGeneros as revisarGenerosDeFaixas,
  type FaixaComparavel,
  type FaixaMinima,
} from '@aurial/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import {
  isNvidiaConfigured,
  pressaoDeCotaDesdeAUltimaLeitura,
  type PressaoDeCota,
} from '../infra/ai/nvidia.js';
import {
  auditor,
  auditorDeGenero,
  dna,
  faxineiro,
  generista,
  identificador,
  type TrackFacts,
} from './agents.js';

const log = logger.child({ worker: 'curation' });

/** Marca gravada na entrada para não re-auditar a mesma faixa toda volta. */
const AUDIT_FIELD = 'curatedAt';
/** Vetor de significado da faixa, gravado uma vez e reusado pela busca. */
const DNA_FIELD = 'dna';

interface LibraryTrack {
  id?: unknown;
  title?: unknown;
  artists?: unknown;
  album?: unknown;
  genre?: unknown;
  /** Selo, quando o leitor de título o reconhece no nome do canal. */
  label?: unknown;
  /** Usados pelo faxineiro: duração confirma a gravação, capa desempata. */
  durationMs?: unknown;
  coverUrl?: unknown;
}
interface LibraryEntry {
  track?: LibraryTrack;
  addedAt?: unknown;
  [AUDIT_FIELD]?: unknown;
  [DNA_FIELD]?: unknown;
  /** Última conferência da CATEGORIA — o rodízio de `auditarGeneros`. */
  generoAuditadoEm?: number;
}

/** Extrai os fatos que os agentes consomem. */
function factsOf(track: LibraryTrack): TrackFacts {
  return {
    title: typeof track.title === 'string' ? track.title.trim() : '',
    artists: artistNames(track),
    album: typeof track.album === 'string' ? track.album : null,
    genre: typeof track.genre === 'string' ? track.genre : null,
  };
}

function artistNames(track: LibraryTrack): string[] {
  if (!Array.isArray(track.artists)) return [];
  return track.artists
    .map((a) => (a && typeof a === 'object' ? (a as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim());
}

/** Entrada elegível: tem título, tem artista atribuído e não foi vista há um tempo. */
function isDue(entry: LibraryEntry, now: number): boolean {
  const track = entry.track;
  if (!track || typeof track.title !== 'string' || !track.title.trim()) return false;

  const names = artistNames(track);
  // "Desconhecido" é o placeholder do cliente — vale auditar para descobrir quem é.
  if (names.length === 0) return true;

  const curatedAt = typeof entry[AUDIT_FIELD] === 'number' ? (entry[AUDIT_FIELD] as number) : 0;
  const maxAge = env.CURATION_RECHECK_DAYS * 24 * 3600_000;
  return now - curatedAt > maxAge;
}

/**
 * Audita uma faixa. Devolve os campos a gravar, ou `null` quando nada muda.
 *
 * Dois passos de propósito: o auditor (barato, uma palavra) decide SE está
 * errado; só então o identificador (caro, JSON completo) descobre o certo.
 * Rodar o caro em tudo gastaria cota à toa na maioria, que já está correta.
 */
async function auditTrack(entry: LibraryEntry): Promise<Record<string, unknown> | null> {
  const track = entry.track!;
  const title = (track.title as string).trim();
  const names = artistNames(track);
  const current = names.join(', ');
  const facts = { title, artists: names };

  if (names.length > 0) {
    // `true` (confirmado) e `null` (incerto) param aqui: só marcamos a data.
    if ((await auditor(facts)) !== false) return { [AUDIT_FIELD]: Date.now() };
  }

  const identity = await identificador(facts);
  if (!identity) return { [AUDIT_FIELD]: Date.now() };

  const patch: Record<string, unknown> = { [AUDIT_FIELD]: Date.now() };

  const mesmosArtistas =
    identity.artists.length === names.length &&
    identity.artists.every((a, i) => a.toLowerCase() === names[i]?.toLowerCase());

  if (!mesmosArtistas) {
    log.info(
      { title, de: current || '(vazio)', para: identity.artists.join(', ') },
      'atribuição corrigida',
    );
    patch['track.artists'] = identity.artists.map((name, i) => ({
      id: `ai:${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      imageUrl: null,
      order: i,
    }));
  }

  const tituloNovo = tituloMelhor(title, identity.title);
  if (tituloNovo) {
    log.info({ de: title, para: tituloNovo }, 'título corrigido');
    patch['track.title'] = tituloNovo;
  }

  if (identity.genre) patch['track.genre'] = identity.genre;
  // O selo tem campo próprio agora — antes, quando o modelo o reconhecia, ele
  // vinha junto dos artistas e virava "quem canta". Guardado aqui, ele alimenta
  // a página da gravadora sem contaminar a ficha do artista.
  if (identity.label) patch['track.label'] = identity.label;

  return patch;
}

/**
 * Decide se vale trocar o título. Devolve o novo, ou `null` para deixar como está.
 *
 * ISSO EXISTE PORQUE o worker corrigia só o artista: uma entrada com título
 * "GERALDO AZEVEDO" e artista "Desconhecido" ganhava o artista certo e
 * continuava com o nome do artista no lugar do nome da música. Metade do
 * conserto parece conserto até você olhar a prateleira.
 *
 * O corte é conservador: título diferente de verdade, troca; diferença só de
 * caixa, troca apenas quando o atual está GRITANDO — porque aí o "igual" é o
 * mesmo texto, e o que muda é a apresentação.
 */
function tituloMelhor(atual: string, sugerido: string): string | null {
  const limpo = sugerido.trim();
  if (!limpo) return null;

  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  if (norm(atual) === norm(limpo)) {
    const gritando = atual === atual.toUpperCase() && /[A-ZÀ-Ú]{4,}/.test(atual);
    return gritando && limpo !== limpo.toUpperCase() ? limpo : null;
  }
  return limpo;
}

/**
 * A JANELA PRECISA ANDAR — senão ela lê as mesmas faixas para sempre.
 *
 * A consulta era `.limit(CURATION_BATCH * 4)` e mais nada. Sem `orderBy`, o
 * Firestore devolve por ID de documento, sempre na mesma ordem: a volta lia
 * EXATAMENTE as mesmas 160 primeiras faixas, de quinze em quinze minutos, para
 * sempre. Duas consequências, e a segunda é a que explica o relato:
 *
 *  - CUSTO: 160 leituras × 96 voltas por dia = ~15 mil leituras por usuário, por
 *    dia, relendo o que já estava em dia. O limite grátis do projeto é 50 mil, e
 *    ele estourou de novo hoje (429 RESOURCE_EXHAUSTED na coleção inteira).
 *  - COBERTURA: quem estava DEPOIS da 160ª faixa nunca foi curado. Nem auditado,
 *    nem categorizado, nem vetorizado. Um worker "24/7" que nunca chegava na
 *    metade de baixo da biblioteca — e é justamente lá que sobrou o trap no
 *    sertanejo.
 *
 * O cursor abaixo faz a janela andar: cada volta continua de onde a anterior
 * parou e volta ao começo ao chegar no fim. Mesmo custo por volta, biblioteca
 * inteira coberta em poucas voltas. Ele vive em memória de propósito — reiniciar
 * o worker recomeça do início, que é o comportamento certo depois de um deploy.
 */
const cursorPorUsuario = new Map<string, string>();

async function curateUser(userId: string): Promise<number> {
  const janela = env.CURATION_BATCH * 4; // folga: a maioria já estará em dia
  const desde = cursorPorUsuario.get(userId);

  const linhas = await prisma.userCollectionItem.findMany({
    where: {
      userId,
      collection: 'library',
      deleted: false,
      ...(desde ? { itemId: { gt: desde } } : {}),
    },
    orderBy: { itemId: 'asc' },
    take: janela,
  });

  // Chegou ao fim da coleção: recomeça do início na PRÓXIMA volta (não agora —
  // reler tudo de uma vez é justamente o desperdício que estamos cortando).
  if (linhas.length === 0 && desde) {
    cursorPorUsuario.delete(userId);
    return 0;
  }
  const ultimo = linhas.at(-1);
  if (ultimo && linhas.length === janela) cursorPorUsuario.set(userId, ultimo.itemId);
  else cursorPorUsuario.delete(userId); // página final: próxima volta começa do topo

  const docs = linhas.map((linha) =>
    docDoPostgres(userId, linha.itemId, (linha.data ?? {}) as LibraryEntry),
  );

  const now = Date.now();
  const due = docs.filter((d) => isDue(d.data(), now)).slice(0, loteEmVigor());

  let corrigidas = 0;

  if (due.length > 0) {
    log.info({ usuario: userId.slice(0, 8), pendentes: due.length }, 'auditando');

    // Todas de uma vez: o pool em nvidia.ts é quem segura o ritmo real.
    const results = await Promise.all(
      due.map(async (doc) => {
        try {
          const patch = await auditTrack(doc.data());
          if (!patch) return false;
          await doc.ref.update(patch);
          return Object.keys(patch).length > 1; // mais que só a data = corrigiu
        } catch (err) {
          log.warn({ err, doc: doc.id }, 'falha ao auditar faixa');
          return false;
        }
      }),
    );
    corrigidas = results.filter(Boolean).length;
  }

  // AS CATEGORIAS VEEM A BIBLIOTECA INTEIRA, não a janela.
  //
  // A janela existe para racionar chamadas de IA. Só que a primeira das três
  // passagens de categoria — a revisão — é REGRA PURA: normalizar grafia e
  // esvaziar balde ("Brasileira" não é gênero) não custa rede nenhuma. Presa na
  // janela de 160, uma biblioteca de 4.416 faixas levaria vinte e oito voltas,
  // ou seja mais de um dia, para limpar o que dá para limpar em segundos.
  //
  // As outras duas continuam racionadas: `auditarGeneros` e `preencherGeneros`
  // têm `.slice(0, CURATION_BATCH)` por dentro, então ver mais faixas não gasta
  // mais IA — só melhora a decisão. E melhora de verdade: quem vota se uma
  // faixa destoa é a discografia do artista (`generoDoArtista`), e com a
  // biblioteca inteira à vista esse voto passa a ser a discografia INTEIRA em
  // vez de um pedaço arbitrário de 160. É exatamente o que separa um trap solto
  // no sertanejo de um sertanejo de verdade.
  const todas = await prisma.userCollectionItem.findMany({
    where: { userId, collection: 'library', deleted: false },
    orderBy: { itemId: 'asc' },
  });
  const docsCompletos = todas.map((linha) =>
    docDoPostgres(userId, linha.itemId, (linha.data ?? {}) as LibraryEntry),
  );
  corrigidas += await curarCategorias(docsCompletos);

  // DNA e fusão de duplicatas seguem na janela: o primeiro tem custo de rede por
  // faixa, e o segundo APAGA (com lápide) — alargar o alcance de quem remove sem
  // pedido é o tipo de mudança que se faz de propósito, não de carona.
  await gravarDna(docs);
  corrigidas += await fundirDuplicatas(docs);

  return corrigidas;
}

/**
 * As três passagens de categoria, na ordem em que fazem sentido.
 *
 * A revisão vem primeiro porque é de graça e porque ela DESTRAVA as outras: ao
 * esvaziar os baldes ("Brasileira" não é gênero), devolve para `preencherGeneros`
 * um monte de faixa que estava escondida atrás de um campo preenchido.
 */
async function curarCategorias(docs: LibraryDoc[]): Promise<number> {
  // A GRAVADORA SAI DA FRENTE ANTES DE QUALQUER COISA — e a ordem é o ponto.
  //
  // Faixa importada do canal de um selo fica com o NOME DO SELO como artista
  // principal ("MK MUSIC, Anderson Freire"). Todas as passagens abaixo decidem
  // olhando `artistas[0]`, então enquanto o selo estiver ali elas trabalham com
  // a premissa errada: onze faixas de cantores diferentes votam juntas, nenhuma
  // maioria se forma, e o gênero errado da fonte sobrevive. Foi assim que
  // "Raridade", do Anderson Freire, ficou em Sertanejo e a prateleira Gospel
  // apareceu vazia de músicas que estavam lá dentro.
  //
  // Devolvido o crédito, a coerência por artista volta a funcionar sozinha: a
  // discografia do Anderson Freire é Gospel por maioria, e ela puxa a faixa
  // que destoa. Consertar o dado é melhor que ensinar cada passagem a
  // desconfiar dele.
  // O leitor de título vem PRIMEIRO de todos: ele é quem separa o que é música,
  // o que é gente e o que é selo dentro do nome do vídeo. Tudo depois disso —
  // promoção de artista, coerência de gênero, duplicata — lê esses campos.
  let corrigidas = await uniformizarTitulos(docs);
  corrigidas += await promoverArtistas(docs);
  corrigidas += await revisarGeneros(docs); // regra pura, sem IA
  corrigidas += await auditarGeneros(docs); // confere o que já tem categoria
  corrigidas += await preencherGeneros(docs); // preenche quem está sem
  return corrigidas;
}

/**
 * Tira o nome da gravadora da frente do artista de verdade.
 *
 * Conserta três coisas de uma vez, porque as três liam o mesmo campo errado: a
 * foto da ficha (que trazia o logotipo do selo), a categoria (ver acima) e a
 * prateleira de artistas (onde o selo aparecia como se fosse um cantor com
 * dezenas de faixas). Ver `promoverArtistaReal` em shared.
 */
async function promoverArtistas(docs: LibraryDoc[]): Promise<number> {
  let corrigidas = 0;
  for (const doc of docs) {
    const track = doc.data().track;
    if (!Array.isArray(track?.artists)) continue;
    const artistas = track.artists as Array<{ name?: unknown }>;
    if (!artistas.every((a) => a && typeof a.name === 'string')) continue;

    // SEPARA ANTES DE PROMOVER — sem isto o conserto não alcança o dado real.
    //
    // No banco, `artists` costuma ter UM item cujo nome é a lista inteira:
    // `[{name: "MK MUSIC, Elaine Martins"}]`. A promoção procura o selo no
    // primeiro item e promove o PRÓXIMO — e como só existe um item, ela não
    // tinha o que promover e devolvia "nada a fazer", silenciosamente. O
    // conserto foi para produção e a prateleira Gospel continuou vazia, sem
    // nenhum erro no log dizendo por quê.
    const nomes = artistas.map((a) => a.name as string);
    const separados = separarArtistasGrudados(nomes);

    // "Oficial" também sai do que JÁ ESTÁ SALVO. Sem esta passagem, "Gabriela
    // Rocha" e "Gabriela Rocha Oficial" seguiriam como dois artistas — duas
    // prateleiras, duas fotos, e a votação de gênero dividida entre as duas
    // metades da mesma discografia.
    const base = separados ?? nomes;
    const limpos = base.map((n) => limparNomeDeArtista(n));
    const mudouONome = limpos.some((n, i) => n !== base[i]);

    const lista: Array<{ name: string }> =
      separados || mudouONome
        ? limpos.map((name, i) => ({ ...(artistas[i] ?? {}), name }) as { name: string })
        : (artistas as Array<{ name: string }>);

    const novo = promoverArtistaReal(lista) ?? (separados || mudouONome ? lista : null);
    if (!novo) continue;
    try {
      await doc.ref.update({ 'track.artists': novo });
      corrigidas += 1;
      log.info(
        { doc: doc.id, de: artistas[0]?.name, para: novo[0]?.name },
        'gravadora saiu da frente do artista',
      );
    } catch (err) {
      log.warn({ err, doc: doc.id }, 'falha ao promover o artista');
    }
  }
  if (corrigidas > 0) log.info({ corrigidas }, 'créditos de artista devolvidos');
  return corrigidas;
}

/**
 * PASSA O QUE JÁ ESTÁ SALVO PELO LEITOR DE TÍTULO DE VÍDEO.
 *
 * Toda faixa importada por link nasce do nome de um vídeo, e nome de vídeo é
 * frase de propaganda, não metadata. As que entraram antes do leitor existir
 * ficaram como vieram — e é por isso que a biblioteca tem título com "(Official
 * Video)" grudado, número de faixa na frente, e nos piores casos o nome da
 * música no campo do artista e a lista de cantores no campo do título.
 *
 * Não basta consertar dali para a frente: enquanto o acervo antigo continuar
 * torto, a busca acha a mesma música duas vezes, a prateleira de artista mostra
 * canal, e a duplicata não se reconhece. Uniformizar o que já existe é metade
 * do conserto.
 *
 * CONSERVADOR DE PROPÓSITO: só grava quando o leitor melhora de verdade — nome
 * mais curto e não vazio, ou artista que apareceu onde não havia. Título que o
 * leitor devolveria igual, ou pior, fica como está. Reescrever por reescrever
 * numa biblioteca inteira é o tipo de passagem que estraga mais do que arruma.
 */
async function uniformizarTitulos(docs: LibraryDoc[]): Promise<number> {
  let corrigidas = 0;
  for (const doc of docs) {
    const entry = doc.data();
    const track = entry.track;
    const bruto = typeof track?.title === 'string' ? track.title : '';
    if (!bruto.trim()) continue;

    const atuais = artistNames(track ?? {});
    const partes = lerTituloDeVideo(bruto, atuais[0] ?? null);

    const patch: Record<string, unknown> = {};

    // Título: só troca se sobrou algo E ficou mais enxuto. O leitor tira ruído;
    // se o resultado ficou MAIOR, ele entendeu errado e é melhor não gravar.
    const novoTitulo = partes.title.trim();
    if (novoTitulo && novoTitulo.length < bruto.trim().length && novoTitulo.length >= 2) {
      patch['track.title'] = novoTitulo;
    }

    // Artista: só preenche onde estava VAZIO. Sobrescrever atribuição existente
    // é trabalho do auditor, que confere antes; aqui a regra é cega e não tem
    // como saber se o que já está lá veio de uma correção anterior.
    if (atuais.length === 0 && partes.artists.length > 0) {
      patch['track.artists'] = partes.artists.map((name, i) => ({
        id: `video:${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        imageUrl: null,
        order: i,
      }));
    }

    if (partes.label && !track?.label) patch['track.label'] = partes.label;

    if (Object.keys(patch).length === 0) continue;
    try {
      await doc.ref.update(patch);
      corrigidas += 1;
      if (patch['track.title']) {
        log.info({ doc: doc.id, de: bruto, para: patch['track.title'] }, 'título limpo');
      }
    } catch (err) {
      log.warn({ err, doc: doc.id }, 'falha ao uniformizar o título');
    }
  }
  if (corrigidas > 0) log.info({ corrigidas }, 'títulos uniformizados');
  return corrigidas;
}

/**
 * O ACERVO DO APP — a coleção que TODO usuário lê.
 *
 * A curadoria varria `users/{uid}/library` e só. Só que o que o usuário comum vê
 * na tela vem de `catalogo`, e ninguém nunca passou por lá: as categorias
 * erradas do acervo eram corrigidas na biblioteca do admin e o acervo continuava
 * com as antigas. Consertar onde ninguém olha e deixar errado onde todo mundo
 * olha é o pior arranjo possível.
 *
 * Aqui roda a mesma cura de categorias, sobre a coleção que importa. Nada de
 * auditoria de atribuição, DNA ou fusão de duplicatas: essas passagens têm dono
 * (a biblioteca de quem importou) e o acervo é espelho dela.
 *
 * O ACERVO AGORA MORA NO POSTGRES, aqui do lado — não no Firestore. Ler a
 * coleção inteira lá custava uma leitura por faixa, e o limite grátis de 50 mil
 * por dia é do projeto todo: era esta varredura, somada às aberturas do app,
 * que derrubava acervo, sincronia e curtidas juntos. Aqui a mesma varredura é
 * um `SELECT` numa tabela de centenas de linhas, e custa nada.
 */
async function curarAcervo(): Promise<number> {
  const linhas = await prisma.catalogTrack.findMany();
  if (linhas.length === 0) return 0;

  const faixas: FaixaMinima[] = linhas.map((linha) => {
    const track = (linha.data as { track?: LibraryTrack }).track ?? {};
    return {
      id: linha.id,
      genre: typeof track.genre === 'string' ? track.genre : null,
      artistas: artistNames(track),
    };
  });

  // A REVISÃO (regra pura, sem IA) resolve o grosso: esvazia o balde
  // "Brasileira", padroniza grafia e corrige a faixa que destoa de toda a
  // discografia do artista. As mesmas regras que o app usa — ver
  // shared/ai/generoCoerencia.ts.
  const mudancas = revisarGenerosDeFaixas(faixas);
  let corrigidas = 0;
  for (const mudanca of mudancas) {
    const linha = linhas.find((l) => l.id === mudanca.id);
    if (!linha) continue;
    const dados = linha.data as { track?: Record<string, unknown> };
    if (!dados.track) continue;
    try {
      await prisma.catalogTrack.update({
        where: { id: mudanca.id },
        data: { data: { ...dados, track: { ...dados.track, genre: mudanca.para } } },
      });
      corrigidas += 1;
      log.info(
        { faixa: mudanca.id, de: mudanca.de, para: mudanca.para, motivo: mudanca.motivo },
        'categoria do acervo revisada',
      );
    } catch (err) {
      log.warn({ err, faixa: mudanca.id }, 'falha ao revisar categoria do acervo');
    }
  }

  if (corrigidas > 0) log.info({ corrigidas, faixas: linhas.length }, 'acervo curado');
  return corrigidas;
}

/**
 * Funde as duplicatas: a mesma música que entrou duas vezes com títulos
 * diferentes vira uma entrada só.
 *
 * A DECISÃO de fundir é do `faxineiro` (regra pura, testada em shared). Aqui só
 * se executa — e a execução é conservadora de propósito:
 *
 *  - marca a sobrevivente com `duplicatasFundidas`, para o cliente saber que a
 *    entrada absorveu outras (e para dar rastro se algo der errado);
 *  - apaga as demais entradas da BIBLIOTECA, não o áudio: o arquivo no cofre
 *    pode estar sendo servido para outro aparelho, e o cofre tem LRU própria;
 *  - um teto por volta, para que um erro de regra não varra uma biblioteca
 *    inteira antes de alguém perceber.
 */
const MAX_FUSOES_POR_VOLTA = 10;

async function fundirDuplicatas(docs: LibraryDoc[]): Promise<number> {
  const porId = new Map<string, LibraryDoc>();
  const faixas: FaixaComparavel[] = [];

  for (const doc of docs) {
    const entry = doc.data() as LibraryEntry;
    const track = entry.track;
    if (!track || typeof track.title !== 'string' || !track.title.trim()) continue;
    porId.set(doc.id, doc);
    const dnaBruto = entry[DNA_FIELD];
    faixas.push({
      id: doc.id,
      title: track.title,
      artists: artistNames(track),
      durationMs: typeof track.durationMs === 'number' ? track.durationMs : null,
      dna:
        Array.isArray(dnaBruto) && dnaBruto.length === EMBED_DIMS ? (dnaBruto as number[]) : null,
      coverUrl: typeof track.coverUrl === 'string' ? track.coverUrl : null,
      album: typeof track.album === 'string' ? track.album : null,
      addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : null,
    });
  }

  const grupos = faxineiro(faixas).slice(0, MAX_FUSOES_POR_VOLTA);
  if (grupos.length === 0) return 0;

  let fundidas = 0;
  for (const grupo of grupos) {
    const sobrevivente = porId.get(grupo.manter.id);
    if (!sobrevivente) continue;
    try {
      await sobrevivente.ref.update({
        duplicatasFundidas: grupo.remover.map((r) => r.title),
        [AUDIT_FIELD]: Date.now(),
      });
      for (const morta of grupo.remover) {
        const doc = porId.get(morta.id);
        if (doc) await doc.ref.delete();
      }
      fundidas += grupo.remover.length;
    } catch (err) {
      log.warn({ err, manter: grupo.manter.id }, 'falha ao fundir duplicatas');
    }
  }

  if (fundidas > 0) log.info({ fundidas, grupos: grupos.length }, 'duplicatas fundidas');
  return fundidas;
}

/**
 * O CONTRATO MÍNIMO que todas as passagens consomem.
 *
 * Era o `QueryDocumentSnapshot` do Firestore. Reduzi-lo a esta interface é o que
 * permitiu trocar a fonte (Firestore → Postgres) sem tocar em NENHUMA das seis
 * passagens de curadoria — elas continuam falando `doc.id`, `doc.data()`,
 * `doc.ref.update(...)`. Trocar a fonte e reescrever as regras no mesmo passo
 * seria trocar um defeito conhecido por vários desconhecidos.
 */
interface LibraryDoc {
  id: string;
  data(): LibraryEntry;
  ref: {
    /** Aceita caminho pontilhado (`'track.genre'`), como o Firestore aceitava. */
    update(patch: Record<string, unknown>): Promise<void>;
    delete(): Promise<void>;
  };
}

/**
 * Aplica um patch de caminhos pontilhados sobre o JSON da entrada.
 *
 * As passagens gravam `{'track.genre': 'Trap'}` — sintaxe do Firestore, que
 * atualiza SÓ aquele campo. Um `update` de JSON no Postgres substitui o
 * documento inteiro, então quem traduz é esta função: sem ela, gravar o gênero
 * apagaria título, artistas, capa e duração da faixa junto.
 */
const SEGMENTOS_PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype']);

export function aplicarPatch(dados: LibraryEntry, patch: Record<string, unknown>): LibraryEntry {
  const saida: Record<string, unknown> = { ...(dados as Record<string, unknown>) };
  for (const [caminho, valor] of Object.entries(patch)) {
    const partes = caminho.split('.');

    // CAMINHO MALFORMADO NÃO GRAVA NADA — nem meia coisa, nem em outro lugar.
    //
    // Os caminhos vêm de código legado que fala a sintaxe do Firestore, e um
    // `split('.')` aceita tudo em silêncio: `''` virava uma chave vazia na raiz
    // da entrada, `'.genre'` criava um objeto `{"": {...}}` do lado da faixa, e
    // `'track.'` enfiava uma chave vazia DENTRO da faixa. Nenhum desses casos
    // aparece no log — a gravação "funciona", só grava no lugar errado, e a
    // biblioteca do usuário acumula lixo que ninguém sabe de onde veio.
    if (partes.some((p) => p === '')) {
      throw new Error(`caminho de patch malformado: ${JSON.stringify(caminho)}`);
    }
    if (partes.some((p) => SEGMENTOS_PROIBIDOS.has(p))) {
      // `alvo['__proto__'] = {}` cai no acessor: o patch some, o objeto sai com
      // o protótipo trocado e o `update` responde sucesso. Silêncio de novo.
      throw new Error(`caminho de patch proibido: ${JSON.stringify(caminho)}`);
    }

    if (partes.length === 1) {
      saida[caminho] = valor;
      continue;
    }
    let alvo = saida;
    for (const parte of partes.slice(0, -1)) {
      const atual = alvo[parte];
      // ARRAY NO MEIO DO CAMINHO É RECUSA, NÃO CONVERSÃO.
      //
      // `{'track.artists.0.name': 'X'}` transformava `artists: [{...}]` em
      // `artists: {"0": {...}}` — a lista de artistas deixava de ser lista.
      // Todo o resto do sistema faz `Array.isArray(track.artists)` antes de
      // olhar, então a partir daí a faixa fica sem artista NENHUM: some da
      // prateleira do artista, perde o voto de gênero, e não há erro no log.
      // É exatamente o "estrago máximo e silencioso" que este arquivo teme.
      //
      // Escalar e nulo continuam virando mapa, que é o que o Firestore fazia e
      // é como o nível intermediário nasce numa entrada nova.
      if (Array.isArray(atual)) {
        throw new Error(
          `caminho de patch atravessaria uma lista: ${JSON.stringify(caminho)} (em ${parte})`,
        );
      }
      const proximo =
        atual && typeof atual === 'object' ? { ...(atual as Record<string, unknown>) } : {};
      alvo[parte] = proximo;
      alvo = proximo;
    }
    alvo[partes.at(-1) as string] = valor;
  }
  return saida as LibraryEntry;
}

/**
 * Uma faixa da biblioteca no Postgres, vestida de documento.
 *
 * `delete()` NÃO apaga a linha: marca `deleted`. A sincronia por delta descobre
 * o que sumiu pela lápide — uma remoção de verdade seria invisível para os
 * aparelhos, que continuariam mostrando a faixa fundida para sempre.
 */
function docDoPostgres(userId: string, itemId: string, inicial: LibraryEntry): LibraryDoc {
  let dados = inicial;
  const chave = { userId_collection_itemId: { userId, collection: 'library', itemId } };
  return {
    id: itemId,
    data: () => dados,
    ref: {
      async update(patch) {
        dados = aplicarPatch(dados, patch);
        await prisma.userCollectionItem.update({
          where: chave,
          data: { data: dados as object },
        });
      },
      async delete() {
        await prisma.userCollectionItem.update({
          where: chave,
          data: { deleted: true },
        });
      },
    },
  };
}

/** As faixas do lote na forma que as regras de gênero consomem. */
function faixasMinimas(docs: LibraryDoc[]): FaixaMinima[] {
  return docs.map((doc) => {
    const track = (doc.data() as LibraryEntry).track ?? {};
    return {
      id: doc.id,
      genre: typeof track.genre === 'string' ? track.genre : null,
      artistas: artistNames(track),
    };
  });
}

/**
 * PASSO 1 DA CATEGORIA — o que dá para consertar SEM perguntar a ninguém.
 *
 * Três correções de graça, e elas resolvem a maior parte do estrago:
 *
 *  - o balde: o catálogo da Apple devolve "Brasileira" (nacionalidade) para boa
 *    parte do que é nacional, e isso entrava como se fosse gênero. Sertanejo,
 *    trap, gospel e funk no mesmo lugar — e, pior, com o campo preenchido a
 *    faixa ficava invisível para `preencherGeneros`, que só procura quem está
 *    SEM gênero. O balde não era só inútil: ele trancava a porta.
 *  - a grafia: "eletronica" e "Eletrônica" viravam duas prateleiras.
 *  - o discrepante: uma faixa de trap sozinha no meio de uma discografia inteira
 *    de trap não é um artista eclético, é um erro — e a prova já está aqui.
 *
 * As regras vivem em `shared/ai/generoCoerencia.ts`, as MESMAS que o app usa.
 */
async function revisarGeneros(docs: LibraryDoc[]): Promise<number> {
  // SEM TETO, e de propósito.
  //
  // O `.slice(0, CURATION_BATCH)` que estava aqui racionava 40 por volta. Ele
  // fazia sentido quando cada escrita era uma no Firestore, com cota diária do
  // projeto inteiro. Hoje é um UPDATE no Postgres ao lado, e o teto só serve
  // para arrastar por oito horas um trabalho de segundos: 288 rótulos ruins a
  // 40 por hora.
  //
  // E não é um risco novo: `curarAcervo` aplica ESTA MESMA função sem teto
  // nenhum, e foi assim que o acervo saiu de 3.858 faixas para zero rótulo ruim
  // numa volta só. Racionar de um lado o que se aplica inteiro do outro não
  // protege nada — só faz a biblioteca ficar suja mais tempo que o acervo.
  const mudancas = revisarGenerosDeFaixas(faixasMinimas(docs));
  if (mudancas.length === 0) return 0;

  const porId = new Map(docs.map((d) => [d.id, d]));
  let aplicadas = 0;
  for (const mudanca of mudancas) {
    const doc = porId.get(mudanca.id);
    if (!doc) continue;
    try {
      await doc.ref.update({ 'track.genre': mudanca.para });
      aplicadas += 1;
      log.info(
        { doc: doc.id, de: mudanca.de, para: mudanca.para, motivo: mudanca.motivo },
        'categoria revisada',
      );
    } catch (err) {
      log.warn({ err, doc: doc.id }, 'falha ao revisar categoria');
    }
  }
  return aplicadas;
}

/**
 * PASSO 2 DA CATEGORIA — perguntar, para o que a regra não alcança.
 *
 * A revisão acima só enxerga o que destoa DENTRO da biblioteca. Quando o sistema
 * antigo errou de forma consistente — a discografia inteira de um artista de
 * trap rotulada como sertanejo — não há discrepância nenhuma para achar: está
 * tudo igualmente errado, e a coerência até defende o erro.
 *
 * Então aqui se pergunta. Mesmo desenho prudente do auditor de atribuição: o
 * auditor (barato, uma palavra) só decide SE está errado; só com um "NAO" claro
 * é que o generista (caro) diz o que é. "INCERTO" não mexe em nada.
 *
 * O campo `generoAuditadoEm` faz o rodízio: cada volta pega quem está há mais
 * tempo sem conferência, então em algumas voltas a biblioteca inteira passou —
 * e continua passando, para sempre, sem ninguém abrir nada.
 */
const GENRE_AUDIT_FIELD = 'generoAuditadoEm';

async function auditarGeneros(docs: LibraryDoc[]): Promise<number> {
  const agora = Date.now();
  const maxAge = env.CURATION_RECHECK_DAYS * 24 * 3600_000;

  const candidatos = docs
    .map((doc) => {
      const entry = doc.data() as LibraryEntry;
      return {
        doc,
        facts: factsOf(entry.track ?? {}),
        visto: typeof entry[GENRE_AUDIT_FIELD] === 'number' ? entry[GENRE_AUDIT_FIELD] : 0,
      };
    })
    .filter((c) => c.facts.title && c.facts.artists.length > 0 && c.facts.genre)
    .filter((c) => agora - c.visto > maxAge)
    // Quem está há mais tempo sem conferência vai na frente: é o rodízio que
    // garante que toda faixa é reexaminada, em vez de as mesmas sempre.
    .sort((a, b) => a.visto - b.visto)
    .slice(0, loteEmVigor());

  if (candidatos.length === 0) return 0;

  const vereditos = await Promise.all(candidatos.map((c) => auditorDeGenero(c.facts)));
  const errados = candidatos.filter((_, i) => vereditos[i] === false);

  // Todo mundo que foi conferido ganha a data — inclusive quem passou. Sem isso
  // o rodízio não anda e as mesmas faixas seriam reconferidas para sempre.
  await Promise.all(
    candidatos.map((c) => c.doc.ref.update({ [GENRE_AUDIT_FIELD]: agora }).catch(() => undefined)),
  );

  if (errados.length === 0) return 0;

  const novos = await generista(errados.map((c) => c.facts));
  const faixas = faixasMinimas(docs);
  let corrigidas = 0;

  for (let i = 0; i < errados.length; i += 1) {
    const alvo = errados[i]!;
    // A resposta ainda passa pelo crivo do artista: o que contradiz uma maioria
    // FORTE é recusado, e a faixa fica sem categoria. Buraco visível vale mais
    // que categoria errada — é a regra que atravessa este arquivo inteiro.
    const voto = generoDoArtista(faixas, alvo.facts.artists[0] ?? '', alvo.doc.id);
    const novo = aceitarSugestao(novos[i] ?? null, voto);
    if (!novo || novo === alvo.facts.genre) continue;
    try {
      await alvo.doc.ref.update({ 'track.genre': novo });
      corrigidas += 1;
      log.info(
        { doc: alvo.doc.id, de: alvo.facts.genre, para: novo, titulo: alvo.facts.title },
        'categoria reclassificada pelo auditor',
      );
    } catch (err) {
      log.warn({ err, doc: alvo.doc.id }, 'falha ao reclassificar categoria');
    }
  }
  return corrigidas;
}

/**
 * Preenche o gênero de quem está sem. Alimenta as prateleiras por gênero da
 * Home — faixa sem gênero simplesmente não aparece em nenhuma delas.
 */
async function preencherGeneros(docs: LibraryDoc[]): Promise<number> {
  const semGenero = docs
    .map((doc) => ({ doc, facts: factsOf((doc.data() as LibraryEntry).track ?? {}) }))
    .filter(({ facts }) => facts.title && facts.artists.length > 0 && !facts.genre)
    .slice(0, loteEmVigor());

  if (semGenero.length === 0) return 0;

  const generos = await generista(semGenero.map((x) => x.facts));
  const faixas = faixasMinimas(docs);

  let gravados = 0;
  for (let i = 0; i < semGenero.length; i += 1) {
    // Mesmo crivo do resto: o artista vota. Uma resposta que contradiz uma
    // maioria forte é recusada e a faixa continua sem categoria.
    const alvo = semGenero[i]!;
    const voto = generoDoArtista(faixas, alvo.facts.artists[0] ?? '', alvo.doc.id);
    const genero = aceitarSugestao(generos[i] ?? null, voto);
    if (!genero) continue;
    try {
      await semGenero[i]!.doc.ref.update({ 'track.genre': genero });
      gravados += 1;
    } catch (err) {
      log.warn({ err, doc: semGenero[i]!.doc.id }, 'falha ao gravar gênero');
    }
  }

  if (gravados > 0) log.info({ gravados, pendentes: semGenero.length }, 'gêneros atribuídos');
  return gravados;
}

/**
 * Grava o vetor de significado de quem ainda não tem.
 *
 * O DNA é recalculado quando o auditor mexeu no título ou nos artistas — o
 * vetor descreve a faixa que ele viu, e uma faixa renomeada tem outro
 * significado. Por isso a passagem confere o tamanho: vetor de dimensão
 * diferente é de outro modelo e não pode ser comparado com os demais.
 */
async function gravarDna(docs: LibraryDoc[]): Promise<void> {
  const semDna = docs
    .map((doc) => ({ doc, entry: doc.data() as LibraryEntry }))
    .filter(({ entry }) => {
      const atual = entry[DNA_FIELD];
      return !Array.isArray(atual) || atual.length !== EMBED_DIMS;
    })
    .map(({ doc, entry }) => ({ doc, facts: factsOf(entry.track ?? {}) }))
    .filter(({ facts }) => facts.title.length > 0)
    .slice(0, loteEmVigor());

  if (semDna.length === 0) return;

  const vetores = await dna(semDna.map((x) => x.facts));

  let gravados = 0;
  for (let i = 0; i < semDna.length; i += 1) {
    const vetor = vetores[i];
    if (!vetor || vetor.length !== EMBED_DIMS) continue;
    try {
      await semDna[i]!.doc.ref.update({ [DNA_FIELD]: vetor });
      gravados += 1;
    } catch (err) {
      log.warn({ err, doc: semDna[i]!.doc.id }, 'falha ao gravar DNA');
    }
  }

  if (gravados > 0) log.info({ gravados, pendentes: semDna.length }, 'DNA vetorizado');
}

/**
 * O LOTE SE AJUSTA SOZINHO À COTA DA NVIDIA.
 *
 * O lote foi aumentado para a biblioteca convergir em horas em vez de dias — e
 * medido em produção, esse ritmo tomou 15 recusas por cota (429) em quarenta
 * minutos. Recuar no braço resolveria hoje e voltaria a doer amanhã, quando a
 * biblioteca crescesse ou a cota mudasse.
 *
 * Então quem decide o ritmo é a resposta da própria API: cada volta lê quantos
 * 429 aconteceram e ajusta a próxima. Cai rápido (metade) porque insistir sob
 * cota estourada só gera mais recusa; sobe devagar (um quarto) porque voltar
 * correndo ao ritmo que estourou é repetir o erro com passos menores.
 *
 * O piso existe para a fila nunca parar: mesmo sufocado, o worker continua
 * andando, só mais devagar.
 */
const LOTE_MINIMO = 10;
const CHAVE_DO_LOTE = 'curation.lote';

let loteAtual = 0; // 0 = ainda não sabido; ver `carregarLoteAprendido`
let carregado = false;

/**
 * O RITMO NÃO PODE MORRER COM O CONTÊINER.
 *
 * `loteAtual` era uma variável de módulo e nada mais, então cada deploy e cada
 * reinício jogavam fora tudo o que o termostato tinha aprendido. Medido em
 * produção: o worker recriado às 10:55Z voltou ao teto de 150 e queimou 222
 * recusas de cota para reaprender a MESMA descida de ontem (150 → 75 → 37).
 * Isso não é um custo de estreia — é o preço cobrado a cada deploy, e ele cai
 * sobre a cota compartilhada com o resto do app.
 *
 * O valor gravado é um TETO, nunca um chão: `min(teto configurado, aprendido)`.
 * Se alguém baixar `CURATION_BATCH` no ambiente, a memória não pode desfazer a
 * decisão do operador.
 */
async function carregarLoteAprendido(): Promise<void> {
  if (carregado) return;
  carregado = true;
  const teto = env.CURATION_BATCH;
  try {
    const linha = await prisma.workerState.findUnique({ where: { key: CHAVE_DO_LOTE } });
    const gravado = (linha?.value as { lote?: unknown } | null)?.lote;
    if (typeof gravado === 'number' && Number.isFinite(gravado) && gravado > 0) {
      loteAtual = Math.min(teto, Math.max(LOTE_MINIMO, Math.floor(gravado)));
      log.info({ lote: loteAtual, teto }, 'lote aprendido recuperado do banco');
      return;
    }
    loteAtual = loteDeEstreia();
    log.info({ lote: loteAtual, teto }, 'sem lote aprendido — estreando pela metade do teto');
  } catch (err) {
    // Tabela ainda não migrada, banco fora do ar, o que for: o worker NÃO pode
    // deixar de rodar por causa da memória do ritmo. Mas também não volta ao
    // teto cheio — foi ele que queimou as 222 recusas.
    loteAtual = loteDeEstreia();
    log.warn({ err, lote: loteAtual }, 'não deu para ler o lote aprendido — estreando cauteloso');
  }
}

/**
 * Sem memória, começa pela METADE do teto.
 *
 * Estrear no teto é começar pelo ritmo que a produção já provou ser alto demais.
 * Estrear no mínimo desperdiça horas de convergência à toa. A metade erra para o
 * lado barato: se sobrar cota, a subida de um quarto recupera o teto em poucas
 * voltas; se faltar, a queda pela metade custa uma volta em vez de três.
 */
function loteDeEstreia(): number {
  return Math.max(LOTE_MINIMO, Math.floor(env.CURATION_BATCH / 2));
}

/** Grava o ritmo aprendido. Melhor esforço: falhar aqui não pode parar a volta. */
function lembrarLote(lote: number): void {
  void prisma.workerState
    .upsert({
      where: { key: CHAVE_DO_LOTE },
      create: { key: CHAVE_DO_LOTE, value: { lote } },
      update: { value: { lote } },
    })
    .catch((err: unknown) => log.warn({ err, lote }, 'não deu para gravar o lote aprendido'));
}

function ajustarLote(pressao: PressaoDeCota): void {
  const teto = env.CURATION_BATCH;
  if (loteAtual === 0) loteAtual = loteDeEstreia();

  if (pressao.recusas > 0) {
    const novo = Math.max(LOTE_MINIMO, Math.floor(loteAtual / 2));
    if (novo !== loteAtual) {
      log.warn(
        { recusas: pressao.recusas, de: loteAtual, para: novo },
        'cota apertada — diminuindo o lote',
      );
      loteAtual = novo;
      lembrarLote(loteAtual);
    }
    return;
  }

  // VOLTA SEM CHAMADA NENHUMA NÃO É FOLGA — é silêncio, e os dois são "zero
  // recusas". A curadoria lia silêncio como folga e subia o lote. Só que a
  // biblioteca convergida (o estado normal depois de alguns dias) passa quase
  // toda volta sem uma única chamada: o lote escalava sozinho de volta ao teto
  // que estourou a cota, e a próxima leva de importações levava a rajada
  // inteira. O termostato precisa do denominador para saber que mediu alguma
  // coisa.
  if (pressao.chamadas === 0) return;

  if (loteAtual < teto) {
    const novo = Math.min(teto, loteAtual + Math.max(1, Math.floor(teto / 4)));
    log.info({ chamadas: pressao.chamadas, de: loteAtual, para: novo }, 'cota folgada — subindo');
    loteAtual = novo;
    lembrarLote(loteAtual);
  }
}

/** O lote em vigor nesta volta. */
export function loteEmVigor(): number {
  return loteAtual || loteDeEstreia();
}

/**
 * Portas de entrada do teste para o termostato.
 *
 * A regra do ritmo não pode ser verificada por fora: ela só aparece depois de
 * uma volta inteira contra a API real. Expostas assim, o comportamento que
 * importa — cair rápido, subir devagar, nunca zerar, e LEMBRAR — fica travado
 * por teste sem precisar de rede.
 */
export function __ajustarLoteParaTeste(pressao: PressaoDeCota): void {
  ajustarLote(pressao);
}

export async function __carregarLoteParaTeste(): Promise<void> {
  await carregarLoteAprendido();
}

/** Uma passada por todos os usuários. */
async function runOnce(): Promise<void> {
  // ANTES DE QUALQUER CHAMADA: recupera o ritmo aprendido. Aqui, e não em
  // `startCurationWorker`, porque `loteEmVigor()` é síncrono e é lido no meio da
  // volta — carregar de dentro dela garante que ninguém leia o valor de estreia
  // por acidente de ordem.
  await carregarLoteAprendido();

  // SÓ QUEM TEM BIBLIOTECA. Varrer a tabela de usuários traria contas anônimas e
  // de teste — uma consulta por volta, para cada uma, para não achar nada.
  const comBiblioteca = await prisma.userCollectionItem.groupBy({
    by: ['userId'],
    where: { collection: 'library', deleted: false },
  });
  // O ACERVO VEM PRIMEIRO — e a ordem aqui não é estética.
  //
  // Ele era o ÚLTIMO, depois da volta por todos os usuários. Só que a volta por
  // usuário espera a IA faixa a faixa, e observado em produção ela ficou presa
  // em "auditando: 40 pendentes" sem nunca terminar: o acervo não era curado
  // NENHUMA vez. E o acervo é o que aparece na tela de todo mundo, é regra pura
  // (sem IA), custa um `SELECT` e termina em segundos.
  //
  // Barato, visível e determinístico não pode ficar refém de caro, invisível e
  // dependente de terceiro.
  let fixed = await curarAcervo().catch((err) => {
    log.warn({ err }, 'falha ao curar o acervo');
    return 0;
  });

  for (const { userId } of comBiblioteca) {
    fixed += await curateUser(userId).catch((err) => {
      log.warn({ err, usuario: userId.slice(0, 8) }, 'falha ao curar este usuário');
      return 0;
    });
  }
  // A cota teve a palavra final sobre o ritmo da próxima volta.
  //
  // A leitura zera os contadores, e é DE PROPÓSITO que ela acontece uma única
  // vez por volta, no fim: este é o único ponto do processo que lê. Duas
  // leituras por volta partiriam a medição em duas janelas e a segunda veria
  // zero — que, sem o denominador, seria confundido com folga.
  ajustarLote(pressaoDeCotaDesdeAUltimaLeitura());

  if (fixed > 0) {
    log.info(
      { corrigidas: fixed, usuarios: comBiblioteca.length, lote: loteEmVigor() },
      'volta concluída',
    );
  }
}

/**
 * Sobe o laço 24/7. Devolve uma função de parada para o desligamento gracioso.
 */
export function startCurationWorker(): () => void {
  // O FIREBASE SAIU DAQUI. A curadoria lê e grava no nosso Postgres; a única
  // dependência externa que resta é a NVIDIA, e sem ela não há o que auditar.
  if (!isNvidiaConfigured()) {
    log.warn('curadoria desligada: NVIDIA_API_KEY ausente');
    return () => undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    try {
      await runOnce();
    } catch (err) {
      log.error({ err }, 'volta de curadoria falhou');
    }
    if (stopped) return;
    timer = setTimeout(() => void loop(), env.CURATION_INTERVAL_MS);
    timer.unref();
  };

  log.info(
    {
      intervaloMs: env.CURATION_INTERVAL_MS,
      lote: env.CURATION_BATCH,
      paralelo: env.NVIDIA_CONCURRENCY,
    },
    'curadoria 24/7 iniciada',
  );
  void loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
