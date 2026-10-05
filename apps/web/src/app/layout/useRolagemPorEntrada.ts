import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * RESTAURAÇÃO DE ROLAGEM por entrada do histórico.
 *
 * O `ScrollRestoration` do react-router só conhece a JANELA; aqui quem rola é o
 * `<main>` do AppShell. Mesma ideia dele: a posição é guardada por
 * `location.key` (sessionStorage, com teto de entradas); voltar (POP) devolve a
 * posição, ir adiante (PUSH) começa do topo.
 *
 * CUSTO. Não há trabalho por quadro em repouso: um ouvinte `scroll` PASSIVO só
 * faz uma atribuição (o valor é lido ao sair da página, não a cada quadro), e
 * a restauração é dirigida por ResizeObserver — só reage enquanto o conteúdo
 * ainda está crescendo (página lazy, lista virtual, dados que chegam) e para
 * assim que a posição foi alcançada, a pessoa toca/rola, ou passam 3 s.
 */

const STORAGE_KEY = 'radinho:rolagem';
/** Quantas entradas guardar (as mais antigas saem primeiro). */
export const LIMITE_DE_ENTRADAS = 60;
const TEMPO_MAX_MS = 3_000;
/** Conteúdo parado por este tempo depois de alcançar a posição = assentou. */
const ASSENTAR_MS = 600;

type Posicoes = Record<string, number>;

function lerTudo(): Posicoes {
  try {
    const bruto = window.sessionStorage.getItem(STORAGE_KEY);
    if (!bruto) return {};
    const dado = JSON.parse(bruto) as unknown;
    return dado && typeof dado === 'object' ? (dado as Posicoes) : {};
  } catch {
    return {};
  }
}

export function guardarRolagem(chave: string, y: number): void {
  try {
    const todas = lerTudo();
    delete todas[chave]; // reinsere no fim: a ordem das chaves é a recência
    todas[chave] = Math.max(0, Math.round(y));
    const chaves = Object.keys(todas);
    for (const velha of chaves.slice(0, Math.max(0, chaves.length - LIMITE_DE_ENTRADAS))) {
      delete todas[velha];
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(todas));
  } catch {
    /* sem sessionStorage: volta ao topo, como antes */
  }
}

export function lerRolagem(chave: string): number | undefined {
  const y = lerTudo()[chave];
  return typeof y === 'number' ? y : undefined;
}

/**
 * Leva `scroller` até `alvo`, esperando a altura existir. Devolve o cancelador.
 */
export function restaurarQuandoHouverAltura(
  scroller: HTMLElement,
  conteudo: HTMLElement | null,
  alvo: number,
): () => void {
  let ativo = true;
  let quieto: ReturnType<typeof setTimeout> | undefined;
  const parar = (): void => {
    if (!ativo) return;
    ativo = false;
    ro?.disconnect();
    clearTimeout(timer);
    clearTimeout(quieto);
    for (const ev of INTERACOES) scroller.removeEventListener(ev, parar);
  };
  const tentar = (): void => {
    if (!ativo) return;
    const alcance = scroller.scrollHeight - scroller.clientHeight;
    if (alcance < alvo - 1) return; // ainda sem altura: espera a próxima medida
    // Alcançada a posição, o observador continua por um instante: conteúdo que
    // chega ACIMA dela (prateleiras, cabeçalho) faz o navegador "ancorar" e
    // empurrar a rolagem de novo. Cada medida reaplica o alvo; a restauração só
    // termina quando o conteúdo ficou quieto por ASSENTAR_MS.
    if (Math.abs(scroller.scrollTop - alvo) > 1) {
      scroller.scrollTo({ top: alvo, behavior: 'instant' as ScrollBehavior });
    }
    clearTimeout(quieto);
    quieto = setTimeout(parar, ASSENTAR_MS);
  };
  const INTERACOES = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const ro = typeof ResizeObserver === 'undefined' || !conteudo ? null : new ResizeObserver(tentar);
  if (conteudo) ro?.observe(conteudo);
  for (const ev of INTERACOES) scroller.addEventListener(ev, parar, { passive: true });
  const timer = setTimeout(parar, TEMPO_MAX_MS);
  tentar();
  return parar;
}

/**
 * @param scroller o contêiner que rola (o `<main>` do AppShell)
 * @param conteudo o miolo cuja altura cresce quando a página carrega
 */
export function useRolagemPorEntrada(
  scroller: HTMLElement | null,
  conteudo: HTMLElement | null,
): void {
  const { key, pathname } = useLocation();
  const tipo = useNavigationType();
  const anterior = useRef<{ key: string; pathname: string } | null>(null);
  const topoVisto = useRef(0);
  const cancelar = useRef<(() => void) | null>(null);

  // O único ouvinte de rolagem: passivo, uma atribuição.
  useEffect(() => {
    if (!scroller) return;
    const aoRolar = (): void => {
      topoVisto.current = scroller.scrollTop;
    };
    scroller.addEventListener('scroll', aoRolar, { passive: true });
    // Fechar a aba / matar o app: a posição fica guardada para a recarga.
    const aoSair = (): void => {
      guardarRolagem(anterior.current?.key ?? 'default', topoVisto.current);
    };
    window.addEventListener('pagehide', aoSair);
    return () => {
      scroller.removeEventListener('scroll', aoRolar);
      window.removeEventListener('pagehide', aoSair);
    };
  }, [scroller]);

  // Layout effect: roda antes de o navegador despachar o `scroll` causado pelo
  // conteúdo velho ter sumido (que zeraria `topoVisto` antes de guardarmos).
  useLayoutEffect(() => {
    if (!scroller) return;
    const prev = anterior.current;
    anterior.current = { key, pathname };
    if (prev?.key === key) return;

    cancelar.current?.();
    cancelar.current = null;

    // REPLACE some com a entrada antiga (digitar na busca troca a URL a cada
    // letra): guardá-la só gastaria o teto de entradas.
    if (prev && tipo !== 'REPLACE') guardarRolagem(prev.key, topoVisto.current);

    const salvo = tipo === 'POP' ? lerRolagem(key) : undefined;
    if (salvo !== undefined && salvo > 0) {
      topoVisto.current = salvo;
      cancelar.current = restaurarQuandoHouverAltura(scroller, conteudo, salvo);
    } else if (prev?.pathname !== pathname) {
      // Página nova (PUSH, ou POP sem nada guardado): começa do topo.
      scroller.scrollTo({ top: 0 });
      topoVisto.current = 0;
    }
    // Mesma página com outra chave (?q=...): a rolagem fica onde está.
  }, [key, pathname, tipo, scroller, conteudo]);

  useEffect(() => () => cancelar.current?.(), []);
}
