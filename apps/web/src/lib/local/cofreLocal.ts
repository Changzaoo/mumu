/**
 * O COFRE LOCAL TEM FUNDO — e quando ele enche, quem quebra não é quem encheu.
 *
 * O `localStorage` de uma origem tem ~5 MB e é COMPARTILHADO por tudo: a
 * biblioteca do usuário, nove caches de enfeite (letras, biografias, top de
 * artista, créditos, capas tentadas…) e, o que ninguém esperava, o PRÓPRIO
 * Firestore. Cada um desses caches foi escrito com um `catch {}` mudo, cada um
 * cresce para sempre e nenhum tem despejo. O de letras, sozinho, chega a
 * megabytes (está escrito lá, em `lyrics.ts`).
 *
 * O estrago que isso causou, na ordem em que acontece:
 *
 *  1. O cache de letras enche o cofre.
 *  2. `aurial:library` não consegue mais gravar. O `setItem` falha por INTEIRO,
 *     então a biblioteca do usuário para de persistir: aparece na sessão, some
 *     na recarga.
 *  3. O Firestore em modo multi-aba usa o localStorage como canal entre abas e
 *     grava uma marca A CADA MUTAÇÃO. Sem espaço, o `setItem` dele estoura
 *     DENTRO do SDK, que trata isso como estado impossível e derruba o cliente:
 *
 *       FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state
 *       (ID: b815) CONTEXT: {"hc":"The quota has been exceeded.
 *        \nsetItem@[native code]…addPendingMutation@…"}
 *
 *     Foi ISSO que apareceu por cima do player, em cima da música tocando: um
 *     despejo de pilha do SDK, causado por um cache de letra, num aparelho que
 *     só queria ouvir uma faixa. Nada disso tinha a ver com o Firestore.
 *
 * A regra que este módulo impõe: NADA de enfeite pode derrubar o essencial.
 * Quem grava o que é do usuário passa por `gravarLocal`, e se faltar espaço o
 * cofre SACRIFICA os caches descartáveis — do menos valioso para o mais — até
 * a gravação caber. Cache descartável é, por definição, o que se busca de novo
 * na próxima vez; a biblioteca do usuário não é.
 *
 * Descartar significa duas coisas juntas, e é por isso que existe registro:
 * apagar a chave E avisar o dono para esquecer a cópia em memória. Só apagar
 * seria inútil — o módulo dono reescreveria os mesmos megabytes no próximo
 * `write()`, e o cofre encheria de novo em segundos.
 */
import { registrarFalhaDePersistencia } from '@/lib/sync/syncStatus';

interface Descartavel {
  chave: string;
  /** Menor = sacrificado primeiro. */
  prioridade: number;
  /** Faz o dono soltar a cópia em memória — sem isto ele reescreve tudo. */
  esquecer: () => void;
}

const descartaveis: Descartavel[] = [];

/**
 * Declara um cache como sacrificável sob pressão de cota.
 *
 * `prioridade` é a ordem do sacrifício, do mais barato de perder para o mais
 * caro. Escala usada hoje:
 *   10 tentativas/contadores (puro controle, some sem o usuário notar)
 *   20 textos e listas refazíveis numa chamada (bio, top, créditos)
 *   30 imagens e impressões digitais
 *   40 letras — as mais caras de perder, e por isso as últimas
 */
export function registrarDescartavel(
  chave: string,
  prioridade: number,
  esquecer: () => void,
): void {
  const existente = descartaveis.findIndex((d) => d.chave === chave);
  const registro: Descartavel = { chave, prioridade, esquecer };
  if (existente >= 0) descartaveis[existente] = registro;
  else descartaveis.push(registro);
}

/** Só para teste: devolve o cofre ao estado de módulo recém-carregado. */
export function esquecerRegistros(): void {
  descartaveis.length = 0;
}

/**
 * A cota estourou?
 *
 * Cada navegador tem seu nome para a mesma falha (`QuotaExceededError` no
 * Chrome, `NS_ERROR_DOM_QUOTA_REACHED` no Firefox, código 22/1014), e o Safari
 * em aba privada chega a lançar sem `name` nenhum — daí o teste pela mensagem
 * no fim. Errar para o lado de "é cota" custa um despejo desnecessário; errar
 * para o outro lado é voltar ao bug.
 */
export function ehCotaEstourada(erro: unknown): boolean {
  if (!erro || typeof erro !== 'object') return false;
  const e = erro as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    /quota|exceeded|espaço|storage is full/i.test(e.message ?? '')
  );
}

function sacrificaveis(exceto: string): Descartavel[] {
  return descartaveis.filter((d) => d.chave !== exceto).sort((a, b) => a.prioridade - b.prioridade);
}

function descartar(alvo: Descartavel): boolean {
  try {
    if (window.localStorage.getItem(alvo.chave) === null) return false;
    // A ordem importa: esquecer ANTES de apagar. Se o dono for avisado depois,
    // uma escrita dele no meio do caminho ressuscita o que acabamos de tirar.
    alvo.esquecer();
    window.localStorage.removeItem(alvo.chave);
    return true;
  } catch {
    return false;
  }
}

/**
 * Grava no localStorage abrindo espaço se for preciso.
 *
 * Devolve `true` quando os bytes ficaram gravados de verdade. `false` significa
 * que nem sacrificando tudo coube — e nesse caso a falha vai para o relatório
 * de sincronia (`/diagnostico`), porque um aparelho nessa situação parece
 * normal na sessão e volta vazio na recarga, para sempre.
 */
export function gravarLocal(chave: string, texto: string): boolean {
  try {
    window.localStorage.setItem(chave, texto);
    return true;
  } catch (erro) {
    if (!ehCotaEstourada(erro)) {
      // Modo privado / storage desligado: não há espaço a liberar.
      registrarFalhaDePersistencia(erro);
      return false;
    }
    for (const alvo of sacrificaveis(chave)) {
      if (!descartar(alvo)) continue;
      try {
        window.localStorage.setItem(chave, texto);
        return true;
      } catch {
        // ainda não coube: continua sacrificando
      }
    }
    registrarFalhaDePersistencia(erro);
    return false;
  }
}

/**
 * Grava um cache que PODE ser perdido, respeitando um teto próprio.
 *
 * A diferença para `gravarLocal` é que aqui a resposta certa para "não coube" é
 * desistir em silêncio, nunca sacrificar outro cache: um enfeite não tem o
 * direito de despejar outro para caber. O teto existe para que o cache não
 * chegue perto do limite do cofre — o de letras crescia sem nenhum e foi ele
 * que encheu tudo.
 */
export function gravarCache(chave: string, texto: string, tetoBytes: number): boolean {
  if (texto.length > tetoBytes) return false;
  try {
    window.localStorage.setItem(chave, texto);
    return true;
  } catch {
    return false;
  }
}

/** Quantos caracteres o app ocupa no cofre — para o /diagnostico. */
export function usoDoCofre(): { total: number; porChave: Array<[string, number]> } {
  const porChave: Array<[string, number]> = [];
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const chave = window.localStorage.key(i);
      if (!chave) continue;
      const tamanho = (window.localStorage.getItem(chave) ?? '').length;
      total += tamanho;
      porChave.push([chave, tamanho]);
    }
  } catch {
    return { total: 0, porChave: [] };
  }
  porChave.sort((a, b) => b[1] - a[1]);
  return { total, porChave };
}
