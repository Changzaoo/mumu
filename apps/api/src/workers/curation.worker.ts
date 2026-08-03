/**
 * Curadoria de metadata 24/7.
 *
 * O PROBLEMA que ele resolve: os agentes de metadata sempre existiram, mas
 * rodavam no NAVEGADOR — só com o app aberto, doze faixas por sessão, com
 * pausas entre elas. Numa biblioteca de milhares de faixas isso nunca termina,
 * e é por isso que nome de artista errado persiste.
 *
 * COMO ele alcança a biblioteca sem o app aberto: a biblioteca de cada usuário
 * espelha no Firestore em `users/{uid}/library` (ver `cloudCollection` no web).
 * Este worker lê de lá, corrige, e escreve de volta — e o `onRemoteUpsert` do
 * cliente aplica a correção em TODOS os aparelhos daquele usuário sozinho.
 * Ninguém precisa abrir nada.
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
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { EMBED_DIMS } from '@aurial/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { getFirebaseApp, isFirebaseEnabled } from '../infra/firebase/firebase.js';
import { isNvidiaConfigured } from '../infra/ai/nvidia.js';
import { auditor, dna, generista, identificador, type TrackFacts } from './agents.js';

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
}
interface LibraryEntry {
  track?: LibraryTrack;
  [AUDIT_FIELD]?: unknown;
  [DNA_FIELD]?: unknown;
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

/** Uma volta sobre a biblioteca de um usuário. Devolve quantas corrigiu. */
async function curateUser(db: Firestore, uid: string): Promise<number> {
  const snapshot = await db
    .collection('users')
    .doc(uid)
    .collection('library')
    .limit(env.CURATION_BATCH * 4) // folga: a maioria já estará em dia
    .get();

  const now = Date.now();
  const due = snapshot.docs
    .filter((d) => isDue(d.data() as LibraryEntry, now))
    .slice(0, env.CURATION_BATCH);

  let corrigidas = 0;

  if (due.length > 0) {
    log.info({ uid: uid.slice(0, 8), pendentes: due.length }, 'auditando');

    // Todas de uma vez: o pool em nvidia.ts é quem segura o ritmo real.
    const results = await Promise.all(
      due.map(async (doc) => {
        try {
          const patch = await auditTrack(doc.data() as LibraryEntry);
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

  // As duas passagens abaixo rodam sobre o snapshot INTEIRO, não só sobre o que
  // estava vencido: gênero e DNA não expiram, ou a faixa tem ou não tem. Uma
  // faixa correta há dois anos nunca entraria na fila de auditoria e ficaria
  // fora da busca semântica para sempre.
  corrigidas += await preencherGeneros(snapshot.docs);
  await gravarDna(snapshot.docs);

  return corrigidas;
}

type LibraryDoc = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

/**
 * Preenche o gênero de quem está sem. Alimenta as prateleiras por gênero da
 * Home — faixa sem gênero simplesmente não aparece em nenhuma delas.
 */
async function preencherGeneros(docs: LibraryDoc[]): Promise<number> {
  const semGenero = docs
    .map((doc) => ({ doc, facts: factsOf((doc.data() as LibraryEntry).track ?? {}) }))
    .filter(({ facts }) => facts.title && facts.artists.length > 0 && !facts.genre)
    .slice(0, env.CURATION_BATCH);

  if (semGenero.length === 0) return 0;

  const generos = await generista(semGenero.map((x) => x.facts));

  let gravados = 0;
  for (let i = 0; i < semGenero.length; i += 1) {
    const genero = generos[i];
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
    .slice(0, env.CURATION_BATCH);

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

/** Uma passada por todos os usuários. */
async function runOnce(db: Firestore): Promise<void> {
  const users = await db.collection('users').listDocuments();
  let fixed = 0;
  for (const user of users) {
    fixed += await curateUser(db, user.id);
  }
  if (fixed > 0) log.info({ corrigidas: fixed, usuarios: users.length }, 'volta concluída');
}

/**
 * Sobe o laço 24/7. Devolve uma função de parada para o desligamento gracioso.
 */
export function startCurationWorker(): () => void {
  if (!isFirebaseEnabled()) {
    log.warn('curadoria desligada: credenciais do Firebase ausentes');
    return () => undefined;
  }
  if (!isNvidiaConfigured()) {
    log.warn('curadoria desligada: NVIDIA_API_KEY ausente');
    return () => undefined;
  }

  // `isFirebaseEnabled()` só olha se as três variáveis estão preenchidas — não
  // se a chave presta. Com o placeholder do .env.example, `cert()` estoura AQUI,
  // fora de qualquer try, e o processo inteiro morre em laço de restart: as
  // filas de transcode, waveform e import caem junto, sem ter nada com Firebase.
  // A curadoria pode ficar desligada; a fila de upload, não.
  let db: Firestore;
  try {
    db = getFirestore(getFirebaseApp());
  } catch (err) {
    log.error({ err }, 'curadoria desligada: credencial do Firebase não carrega');
    return () => undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    try {
      await runOnce(db);
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
