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
import {
  AI_BUDGET,
  identityMessages,
  parseIdentity,
  parseVerify,
  verifyMessages,
} from '@aurial/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { getFirebaseApp, isFirebaseEnabled } from '../infra/firebase/firebase.js';
import { isNvidiaConfigured, nvidiaChat } from '../infra/ai/nvidia.js';

const log = logger.child({ worker: 'curation' });

/** Marca gravada na entrada para não re-auditar a mesma faixa toda volta. */
const AUDIT_FIELD = 'curatedAt';

interface LibraryTrack {
  id?: unknown;
  title?: unknown;
  artists?: unknown;
}
interface LibraryEntry {
  track?: LibraryTrack;
  [AUDIT_FIELD]?: unknown;
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

  if (names.length > 0) {
    const verdict = parseVerify(
      (await nvidiaChat(verifyMessages(title, current), {
        maxTokens: AI_BUDGET.verify,
      })) ?? '',
    );
    // `true` (confirmado) e `null` (incerto) param aqui: só marcamos a data.
    if (verdict !== false) return { [AUDIT_FIELD]: Date.now() };
  }

  const identity = parseIdentity(
    (await nvidiaChat(identityMessages(title, current || undefined), {
      maxTokens: AI_BUDGET.identity,
    })) ?? '',
  );
  if (!identity) return { [AUDIT_FIELD]: Date.now() };

  // Se o identificador chegou nos mesmos nomes, não há correção a fazer.
  const same =
    identity.artists.length === names.length &&
    identity.artists.every((a, i) => a.toLowerCase() === names[i]?.toLowerCase());
  if (same) return { [AUDIT_FIELD]: Date.now() };

  log.info(
    { title, de: current || '(vazio)', para: identity.artists.join(', ') },
    'atribuição corrigida',
  );

  return {
    [AUDIT_FIELD]: Date.now(),
    'track.artists': identity.artists.map((name, i) => ({
      id: `ai:${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      imageUrl: null,
      order: i,
    })),
    ...(identity.genre ? { 'track.genre': identity.genre } : {}),
  };
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
  if (due.length === 0) return 0;

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

  return results.filter(Boolean).length;
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
