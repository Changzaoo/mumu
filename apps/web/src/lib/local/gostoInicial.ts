/**
 * SEMENTE DE GOSTO — o que a pessoa escolheu no primeiro dia.
 *
 * POR QUE ISTO EXISTE. O gosto do app já é calculado (ver
 * `lib/reco/generosDoGosto`), mas ele é feito de COMPORTAMENTO: plays com
 * decaimento no tempo e curtidas. No primeiro dia não existe nem um nem outro,
 * então a Home cai no desempate por tamanho da biblioteca — quem acabou de
 * entrar vê os gêneros maiores do acervo, que não têm relação nenhuma com ele.
 * A escolha do onboarding é o único sinal disponível nesse momento.
 *
 * O QUE ELA NÃO É. Não é uma preferência fixa, e por isso não mora no
 * `settingsStore` junto com tema e equalizador. É um PALPITE INICIAL que perde
 * força à medida que o comportamento real aparece: quem escolheu "rock" e passa
 * um mês ouvindo samba tem que ver samba, sem precisar voltar numa tela de
 * configuração para se corrigir. Quem aplica esse esquecimento é
 * `generosDoGosto` — aqui só se guarda a escolha.
 *
 * UM DOCUMENTO SÓ, SINCRONIZADO. A resposta sobe pela mesma via de curtidas e
 * playlists (`serverCollection`, com fila em disco), sob um id fixo. Sem isso o
 * app perguntaria de novo em cada aparelho — e perguntar duas vezes a mesma
 * coisa é o jeito mais rápido de a escolha parecer inútil.
 */
import { serverCollection } from '@/lib/sync/serverCollection';

/** Id fixo: é uma resposta por pessoa, não uma coleção. */
const ID = 'inicial';
const CHAVE = 'aurial:gosto-inicial';

export interface SementeDeGosto {
  /** Gêneros escolhidos, como aparecem na biblioteca (sem normalizar). */
  generos: string[];
  /** Nomes de artistas escolhidos. */
  artistas: string[];
  /** ISO de quando respondeu. Listas vazias = respondeu "agora não". */
  escolhidoEm: string;
}

const VAZIA: SementeDeGosto = { generos: [], artistas: [], escolhidoEm: '' };

let cache: SementeDeGosto | null | undefined;
const ouvintes = new Set<() => void>();

function emitir(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function saoStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** A escolha guardada, ou `null` se a pessoa ainda não respondeu. */
export function ler(): SementeDeGosto | null {
  if (cache !== undefined) return cache;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : null;
    if (
      lido &&
      typeof lido === 'object' &&
      saoStrings((lido as SementeDeGosto).generos) &&
      saoStrings((lido as SementeDeGosto).artistas)
    ) {
      cache = lido as SementeDeGosto;
    } else {
      cache = null;
    }
  } catch {
    cache = null;
  }
  return cache;
}

/**
 * Grava sem re-enviar — é o caminho por onde a sincronia aplica o que veio de
 * outro aparelho. Quem chama daqui NÃO pode empurrar de volta.
 */
function aplicar(semente: SementeDeGosto): void {
  cache = semente;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(semente));
  } catch {
    /* cota cheia: a escolha vale só nesta sessão, e é melhor que travar a tela */
  }
  emitir();
}

const nuvem = serverCollection<SementeDeGosto>({
  // 'gosto' precisa estar na lista fechada de
  // apps/api/src/modules/collections/collections.controller.ts. Enquanto a API
  // não subir com ela, a escrita fica na fila em disco e o app funciona igual:
  // a semente é local antes de ser remota.
  name: 'gosto',
  localItems: () => {
    const atual = ler();
    return atual ? [[ID, atual] as [string, SementeDeGosto]] : [];
  },
  onRemoteUpsert: (_id, data) => {
    // O aparelho que respondeu MAIS RECENTE vence. Sem esta comparação, uma
    // sincronia atrasada sobrescreveria uma escolha nova pela antiga.
    const atual = ler();
    if (atual && atual.escolhidoEm >= (data.escolhidoEm ?? '')) return;
    aplicar({
      generos: saoStrings(data.generos) ? data.generos : [],
      artistas: saoStrings(data.artistas) ? data.artistas : [],
      escolhidoEm: data.escolhidoEm ?? new Date().toISOString(),
    });
  },
  onRemoteDelete: () => {
    cache = null;
    try {
      window.localStorage.removeItem(CHAVE);
    } catch {
      /* nada a fazer */
    }
    emitir();
  },
});

/** Liga/desliga a sincronia entre aparelhos (chamado na troca de sessão). */
export const setUser = nuvem.setUser;

/** Registra a escolha e a manda para os outros aparelhos. */
export function salvar(generos: readonly string[], artistas: readonly string[]): void {
  const semente: SementeDeGosto = {
    generos: [...new Set(generos)],
    artistas: [...new Set(artistas)],
    escolhidoEm: new Date().toISOString(),
  };
  aplicar(semente);
  nuvem.push(ID, semente);
}

/**
 * "Agora não" — grava a resposta VAZIA de propósito.
 *
 * Guardar o "pulei" é o que impede a tela de reaparecer a cada abertura. Sem
 * isso, quem não quer escolher é perguntado para sempre.
 */
export function pular(): void {
  salvar([], []);
}

/** Já respondeu alguma coisa (inclusive "agora não")? */
export function respondeu(): boolean {
  return ler() !== null;
}

/** Ainda falta perguntar. */
export function precisaEscolher(): boolean {
  return !respondeu();
}

/** Apaga a escolha — usado por "refazer" nas configurações e pelos testes. */
export function limpar(): void {
  cache = null;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
  nuvem.remove(ID);
  emitir();
}

/** Leitura estável para `useSyncExternalStore` (mesma referência entre renders). */
export function snapshot(): SementeDeGosto {
  return ler() ?? VAZIA;
}
