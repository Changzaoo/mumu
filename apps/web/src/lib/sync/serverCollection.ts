/**
 * serverCollection — espelha uma loja local no NOSSO servidor, com fila offline.
 *
 * Substitui `cloudCollection` (Firestore) mantendo a MESMA interface de
 * propósito: quem usa troca uma linha de import e nada mais. Biblioteca,
 * curtidas e playlists migram juntas por causa disso.
 *
 * POR QUE SAIU DO FIRESTORE. O primeiro snapshot de cada sessão trazia a
 * coleção INTEIRA, cobrada por documento, e o limite grátis é do PROJETO —
 * quando estourava, caíam juntos acervo, sincronia e curtidas. Aconteceu três
 * vezes. Aqui o cliente guarda um cursor e pergunta "o que mudou desde X"; na
 * maioria das aberturas a resposta é uma lista vazia.
 *
 * ── O QUE MUDA DE VERDADE: A ESCRITA NÃO DEPENDE MAIS DA REDE ──
 *
 * No Firestore, `push` era disparado contra a rede e, se falhasse, o SDK
 * guardava internamente — ou não, dependendo do estado do cliente. Aqui a
 * escrita entra numa fila em disco ANTES de qualquer tentativa (ver
 * `filaOffline.ts`), e a fila é drenada quando dá. Consequências:
 *
 *  - servidor fora do ar: você curte, o coração fica vermelho, e a curtida sobe
 *    sozinha quando ele voltar — mesmo que você feche o app no meio;
 *  - aba fechada com escrita em voo: nada se perde, porque a fila é gravada
 *    antes do envio, não depois da falha;
 *  - rajada offline (curtir/descurtir várias vezes) vira UMA escrita: a fila
 *    guarda uma entrada por item e a última operação vence.
 *
 * O CURSOR E A UNIÃO. Na primeira sincronia deste aparelho não há cursor: o
 * servidor manda tudo, e o que existe só aqui sobe. Depois disso só trafega
 * diferença. O cursor mora no IndexedDB junto com o resto — perdê-lo custa uma
 * sincronia completa, nunca um dado.
 */
import { getIdToken } from '@/lib/firebase';
import { confirmar, enfileirar, pendentes } from '@/lib/sync/filaOffline';
import {
  registrarErro,
  registrarSnapshot,
  registrarUniao,
  registrarUsuario,
} from '@/lib/sync/syncStatus';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');
/** De quanto em quanto tempo perguntamos por novidades de outros aparelhos. */
const SINCRONIA_MS = 60_000;
/** Itens por requisição — a fila de um aparelho novo sobe em blocos. */
const POR_LOTE = 200;

export interface ServerCollection<T> {
  /** Grava um item (vai para a fila primeiro; sobe quando der). */
  push: (id: string, data: T) => void;
  /** Apaga um item (mesma fila, mesma garantia). */
  remove: (id: string) => void;
  /** Começa (uid) ou para (null) de sincronizar. */
  setUser: (uid: string | null) => void;
}

export interface ServerCollectionConfig<T> {
  /** Nome da coleção no servidor — precisa estar na lista fechada da API. */
  name: string;
  /** O que já existe aqui, para subir na primeira sincronia. */
  localItems: () => Iterable<[string, T]>;
  /** Aplica uma mudança vinda do servidor — NÃO pode re-enviar. */
  onRemoteUpsert: (id: string, data: T) => void;
  /** Aplica uma remoção vinda do servidor — NÃO pode re-enviar. */
  onRemoteDelete: (id: string) => void;
  /**
   * Aplica um LOTE de uma vez.
   *
   * A primeira sincronia traz a coleção inteira, e entregá-la item a item fazia
   * a loja local reconstruir o array a cada faixa — O(n²) de cópia e um
   * recálculo de álbuns/artistas/gêneros por item, no exato momento em que o
   * usuário espera a tela. Quem não implementa cai no caminho item a item.
   */
  onRemoteBatch?: (upserts: Array<[string, T]>, deletes: string[]) => void;
}

// ── cursor por coleção (IndexedDB, junto com a fila) ────────────────────────
const CURSOR_PREFIXO = 'aurial:cursor:';

function lerCursor(colecao: string, uid: string): string | null {
  try {
    return window.localStorage.getItem(`${CURSOR_PREFIXO}${colecao}:${uid}`);
  } catch {
    return null;
  }
}

function gravarCursor(colecao: string, uid: string, cursor: string): void {
  try {
    // Poucas dezenas de bytes por coleção: cabe no cofre sem disputa. Perder o
    // cursor custa uma sincronia completa, nunca um dado — por isso não vale
    // sacrificar espaço de coisa maior por ele.
    window.localStorage.setItem(`${CURSOR_PREFIXO}${colecao}:${uid}`, cursor);
  } catch {
    /* cota: a próxima sincronia vem completa, e o resultado é o mesmo */
  }
}

async function autorizacao(): Promise<Record<string, string>> {
  const token = await getIdToken().catch(() => null);
  if (!token) throw new Error('sem sessão');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface ItemRemoto {
  id: string;
  data: unknown;
  deleted: boolean;
  updatedAt: string;
}

export function serverCollection<T>(config: ServerCollectionConfig<T>): ServerCollection<T> {
  let uid: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let semeado = false;
  let drenando = false;

  /**
   * Sobe o que está na fila. Silencioso por natureza: sem rede não há nada a
   * fazer além de esperar, e avisar o usuário a cada tentativa seria ruído.
   */
  const drenar = async (): Promise<void> => {
    if (!uid || drenando) return;
    drenando = true;
    try {
      const fila = (await pendentes()).filter((p) => p.colecao === config.name);
      if (fila.length === 0) return;
      const cabecalho = await autorizacao();

      const gravar = fila.filter((p) => p.operacao === 'gravar');
      const apagar = fila.filter((p) => p.operacao === 'apagar');

      for (let i = 0; i < gravar.length; i += POR_LOTE) {
        const lote = gravar.slice(i, i + POR_LOTE);
        const res = await fetch(`${BASE_URL}/me/colecoes/${config.name}`, {
          method: 'POST',
          headers: cabecalho,
          body: JSON.stringify({ itens: lote.map((p) => ({ id: p.id, data: p.data })) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Confirma LOTE A LOTE: se o próximo falhar, o que já subiu não volta
        // para a fila e não é reenviado à toa.
        await confirmar(lote.map((p) => p.chave));
      }

      for (let i = 0; i < apagar.length; i += POR_LOTE) {
        const lote = apagar.slice(i, i + POR_LOTE);
        const res = await fetch(`${BASE_URL}/me/colecoes/${config.name}/apagar`, {
          method: 'POST',
          headers: cabecalho,
          body: JSON.stringify({ ids: lote.map((p) => p.id) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await confirmar(lote.map((p) => p.chave));
      }
    } catch (erro) {
      // Fica na fila e tenta de novo. É o comportamento desejado, não uma falha.
      registrarErro(config.name, erro);
    } finally {
      drenando = false;
    }
  };

  /** Puxa o que mudou desde o cursor deste aparelho. */
  const puxar = async (): Promise<void> => {
    if (!uid) return;
    const alvo = uid;
    try {
      const cursor = lerCursor(config.name, alvo);
      const url = new URL(`${BASE_URL}/me/colecoes/${config.name}`, window.location.origin);
      if (cursor) url.searchParams.set('desde', cursor);
      const res = await fetch(url.toString().replace(window.location.origin, ''), {
        headers: await autorizacao(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const corpo = (await res.json()) as {
        data?: { itens?: ItemRemoto[]; cursor?: string | null };
      };
      if (uid !== alvo) return; // trocou de conta no caminho

      const itens = corpo.data?.itens ?? [];
      registrarSnapshot(config.name, itens.length, 'servidor');

      // PRIMEIRA SINCRONIA: união. O que existe só aqui sobe — é o que impede
      // uma biblioteca importada offline de sumir ao entrar na conta.
      if (!semeado) {
        semeado = true;
        const idsRemotos = new Set(itens.map((i) => i.id));
        let enviados = 0;
        for (const [id, data] of config.localItems()) {
          if (!idsRemotos.has(id)) {
            push(id, data);
            enviados += 1;
          }
        }
        registrarUniao(config.name, enviados);
        if (enviados > 0) void drenar();
      }

      if (corpo.data?.cursor) gravarCursor(config.name, alvo, corpo.data.cursor);
      if (itens.length === 0) return;

      const upserts: Array<[string, T]> = [];
      const deletes: string[] = [];
      for (const item of itens) {
        if (item.deleted) deletes.push(item.id);
        else upserts.push([item.id, item.data as T]);
      }
      if (config.onRemoteBatch) {
        config.onRemoteBatch(upserts, deletes);
        return;
      }
      for (const id of deletes) config.onRemoteDelete(id);
      for (const [id, data] of upserts) config.onRemoteUpsert(id, data);
    } catch (erro) {
      // Servidor fora do ar: o app segue com o que tem em disco, que é o certo.
      // O motivo NÃO some — era assim que um aparelho ficava para trás sem
      // sintoma nenhum. Ver /diagnostico.
      registrarErro(config.name, erro);
    }
  };

  const ciclo = async (): Promise<void> => {
    await drenar();
    await puxar();
  };

  const agendar = (): void => {
    if (!uid) return;
    timer = setTimeout(() => {
      void ciclo().finally(agendar);
    }, SINCRONIA_MS);
  };

  const push = (id: string, data: T): void => {
    if (!uid) return;
    // A FILA PRIMEIRO, SEMPRE. Enfileirar depois de falhar perderia justamente a
    // escrita que estava em voo quando a aba fechou.
    void enfileirar(config.name, id, 'gravar', data).then(() => drenar());
  };

  const remove = (id: string): void => {
    if (!uid) return;
    void enfileirar(config.name, id, 'apagar').then(() => drenar());
  };

  const acordar = (): void => {
    if (document.visibilityState === 'visible') void ciclo();
  };

  const setUser = (next: string | null): void => {
    if (next === uid) return;
    if (timer) clearTimeout(timer);
    timer = null;
    semeado = false;
    uid = next;
    registrarUsuario(config.name, uid);
    if (!uid) {
      document.removeEventListener('visibilitychange', acordar);
      window.removeEventListener('online', acordar);
      return;
    }
    document.addEventListener('visibilitychange', acordar);
    window.addEventListener('online', acordar);
    void ciclo().finally(agendar);
  };

  return { push, remove, setUser };
}
