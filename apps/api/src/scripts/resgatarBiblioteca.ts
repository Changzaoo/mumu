/**
 * RESGATE — traz de volta o que ficou preso no Firestore.
 *
 * POR QUE ISTO PRECISOU EXISTIR. O registro da biblioteca morava no
 * `localStorage`, que tem ~5 MB. Medido na base real: 1352 bytes por faixa. Aí
 * a conta estoura em algum ponto entre três e quatro mil faixas — e o
 * `setItem` não grava "o que coube", ele falha POR INTEIRO. A biblioteca ficava
 * certa na tela durante a sessão e voltava truncada na recarga, sem aviso.
 *
 * Mas nem tudo se perdeu, e é por isso que este script funciona: a sincronia
 * antiga gravava UM DOCUMENTO POR FAIXA no Firestore. Lá não existe teto de
 * 5 MB por registro. O que sumiu do aparelho continua inteiro na nuvem antiga.
 *
 * O QUE ELE FAZ. Lê `users/{uid}/library` e a coleção `catalogo` do Firestore e
 * grava no Postgres — biblioteca de cada um em `UserCollectionItem`, acervo em
 * `CatalogTrack`.
 *
 * O QUE ELE NUNCA FAZ: apagar. Tudo é upsert. Rodar duas vezes dá o mesmo
 * resultado que rodar uma; rodar sem necessidade não custa nada além de tempo.
 * Num resgate, a única coisa pior que não recuperar é destruir o que sobrou.
 *
 * Uso (no servidor):
 *   docker compose -f infra/docker/docker-compose.prod.yml \
 *     run --rm --entrypoint node api dist/scripts/resgatarBiblioteca.js
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseApp, isFirebaseEnabled } from '../infra/firebase/firebase.js';
import { prisma } from '../infra/db/prisma.js';
import { logger } from '../core/logger.js';

const log = logger.child({ script: 'resgate' });

/** Grava em blocos: uma transação com milhares de upserts derruba a conexão. */
const LOTE = 200;

/**
 * A COTA DO FIRESTORE PODE ESTAR ESGOTADA — E ESPERAR É A RESPOSTA CERTA.
 *
 * O plano gratuito dá 50 mil leituras por dia para o projeto inteiro, e a cota
 * zera à meia-noite do Pacífico (~4h no horário de Brasília). Se o resgate
 * simplesmente falhasse com `RESOURCE_EXHAUSTED`, alguém teria que lembrar de
 * rodar de novo na hora certa — e "alguém lembrar" não é um plano quando o que
 * está em jogo é a biblioteca inteira de uma pessoa.
 *
 * Então ele espera. Tenta, apanha, dorme dez minutos, tenta de novo, por até
 * doze horas. É a janela que garante pegar a virada do dia venha ela quando
 * vier. Não custa nada além do processo ficar de pé.
 */
const ESPERA_MS = 10 * 60_000;
const PACIENCIA_MS = 12 * 3600_000;

function ehCotaEsgotada(erro: unknown): boolean {
  const texto = erro instanceof Error ? erro.message : String(erro);
  return /RESOURCE_EXHAUSTED|Quota exceeded|429/i.test(texto);
}

/** Roda `tentativa` até dar certo ou a paciência acabar; só espera por COTA. */
async function insistindo<T>(rotulo: string, tentativa: () => Promise<T>): Promise<T> {
  const limite = Date.now() + PACIENCIA_MS;
  for (;;) {
    try {
      return await tentativa();
    } catch (erro) {
      // Qualquer outra falha sobe na hora: insistir contra credencial errada ou
      // rede morta só atrasaria o diagnóstico.
      if (!ehCotaEsgotada(erro) || Date.now() > limite) throw erro;
      log.warn(
        { rotulo, proximaEm: `${ESPERA_MS / 60_000}min` },
        'cota do Firestore esgotada — esperando a virada do dia',
      );
      await new Promise((r) => setTimeout(r, ESPERA_MS));
    }
  }
}

interface Entrada {
  track?: { id?: unknown };
  [chave: string]: unknown;
}

/** O id da faixa dentro da entrada — sem ele não há o que gravar. */
function idDaEntrada(id: string, dados: Entrada): string | null {
  const doTrack = dados.track?.id;
  if (typeof doTrack === 'string' && doTrack.trim()) return doTrack.trim();
  return id.trim() || null;
}

async function resgatarBibliotecaDe(uid: string): Promise<number> {
  const db = getFirestore(getFirebaseApp());
  const usuario = await prisma.user.findUnique({ where: { firebaseUid: uid } });
  if (!usuario) {
    log.warn({ uid: uid.slice(0, 8) }, 'sem usuário correspondente no Postgres — pulando');
    return 0;
  }

  const snapshot = await insistindo(`library/${uid.slice(0, 8)}`, () =>
    db.collection('users').doc(uid).collection('library').get(),
  );
  if (snapshot.empty) return 0;

  const itens = snapshot.docs
    .map((doc) => {
      const dados = doc.data() as Entrada;
      const itemId = idDaEntrada(doc.id, dados);
      return itemId ? { itemId, dados } : null;
    })
    .filter((x): x is { itemId: string; dados: Entrada } => x !== null);

  let gravados = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const bloco = itens.slice(i, i + LOTE);
    await prisma.$transaction(
      bloco.map((item) =>
        prisma.userCollectionItem.upsert({
          where: {
            userId_collection_itemId: {
              userId: usuario.id,
              collection: 'library',
              itemId: item.itemId,
            },
          },
          create: {
            userId: usuario.id,
            collection: 'library',
            itemId: item.itemId,
            data: item.dados as object,
            deleted: false,
          },
          // NUNCA sobrescreve o que já está aqui: o Postgres é o registro VIVO,
          // e o Firestore é uma cópia de antes da mudança. Ressuscitar uma
          // versão velha por cima de uma correção da curadoria seria trocar um
          // estrago por outro.
          update: {},
        }),
      ),
    );
    gravados += bloco.length;
  }
  return gravados;
}

async function resgatarAcervo(): Promise<number> {
  const db = getFirestore(getFirebaseApp());
  const snapshot = await insistindo('catalogo', () => db.collection('catalogo').get());
  if (snapshot.empty) return 0;

  const itens = snapshot.docs
    .map((doc) => {
      const dados = doc.data() as Entrada;
      const id = idDaEntrada(doc.id, dados);
      return id ? { id, dados } : null;
    })
    .filter((x): x is { id: string; dados: Entrada } => x !== null);

  let gravados = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const bloco = itens.slice(i, i + LOTE);
    await prisma.$transaction(
      bloco.map((item) =>
        prisma.catalogTrack.upsert({
          where: { id: item.id },
          create: { id: item.id, data: item.dados as object },
          update: {}, // mesma regra: o que já está aqui é mais novo
        }),
      ),
    );
    gravados += bloco.length;
  }
  return gravados;
}

async function main(): Promise<void> {
  if (!isFirebaseEnabled()) {
    log.error('sem credenciais do Firebase — nada a resgatar');
    process.exitCode = 1;
    return;
  }

  const db = getFirestore(getFirebaseApp());

  const antesBiblioteca = await prisma.userCollectionItem.count({
    where: { collection: 'library' },
  });
  const antesAcervo = await prisma.catalogTrack.count();

  const usuarios = await insistindo('users', () => db.collection('users').listDocuments());
  log.info({ usuarios: usuarios.length, antesBiblioteca, antesAcervo }, 'resgate iniciado');

  let total = 0;
  for (const usuario of usuarios) {
    const n = await resgatarBibliotecaDe(usuario.id).catch((err) => {
      log.error({ err, uid: usuario.id.slice(0, 8) }, 'falha no resgate deste usuário');
      return 0;
    });
    if (n > 0) log.info({ uid: usuario.id.slice(0, 8), faixas: n }, 'biblioteca lida');
    total += n;
  }

  const doAcervo = await resgatarAcervo().catch((err) => {
    log.error({ err }, 'falha no resgate do acervo');
    return 0;
  });

  const depoisBiblioteca = await prisma.userCollectionItem.count({
    where: { collection: 'library' },
  });
  const depoisAcervo = await prisma.catalogTrack.count();

  log.info(
    {
      lidasDoFirestore: total,
      acervoLido: doAcervo,
      biblioteca: `${antesBiblioteca} → ${depoisBiblioteca}`,
      acervo: `${antesAcervo} → ${depoisAcervo}`,
      recuperadas: depoisBiblioteca - antesBiblioteca + (depoisAcervo - antesAcervo),
    },
    'resgate concluído',
  );
}

main()
  .catch((err) => {
    log.error({ err }, 'resgate falhou');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
