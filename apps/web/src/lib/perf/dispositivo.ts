/**
 * O APARELHO AGUENTA OS EFEITOS CAROS?
 *
 * O app usa `backdrop-filter: blur(24px)` na barra do player, no mini player, na
 * fila e no topo — e desfoque de fundo é a coisa mais cara que uma interface web
 * pode pedir: o navegador precisa RE-BORRAR tudo que está atrás da superfície a
 * cada quadro. Numa barra que fica sempre visível, isso vira custo permanente, e
 * é exatamente enquanto a pessoa rola a lista que ele aparece como travamento.
 *
 * Em aparelho potente ninguém nota. Em celular de entrada e computador antigo é
 * a diferença entre 60 quadros por segundo e 15.
 *
 * A decisão é tomada UMA vez, no boot, e vira um atributo no `<html>`. O CSS lê
 * dali (ver `globals.css`): nada de checar em componente, nada de re-render.
 */

/** Núcleos abaixo disto = aparelho de entrada. */
const NUCLEOS_MINIMOS = 4;
/** Memória (GB) abaixo disto = aparelho de entrada. */
const MEMORIA_MINIMA = 4;

/**
 * `deviceMemory` não está na tipagem padrão (é proposta, só Chromium a
 * implementa) e `hardwareConcurrency` já existe como obrigatório — por isso a
 * interseção em vez de `extends`, que colidiria com a declaração original.
 */
type NavegadorComPistas = Navigator & { deviceMemory?: number };

/**
 * `true` quando vale trocar beleza por fluidez.
 *
 * Os sinais são grosseiros de propósito — o navegador não expõe nada melhor, e
 * a alternativa (medir quadros por segundo antes de decidir) significaria
 * começar travando para descobrir que trava. Errar aqui é barato nos dois
 * sentidos: um aparelho forte marcado como fraco perde um desfoque; um fraco
 * marcado como forte volta a travar, que é o estado de hoje.
 */
export function dispositivoFraco(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavegadorComPistas;

  // ANTES, "menos movimento" (prefers-reduced-motion) desligava TODO o efeito —
  // vidro, desfoque e aurora. Mas isso confunde duas coisas: quem pede menos
  // movimento quer parar a ANIMAÇÃO, não perder a translucidez (que não se mexe).
  // O resultado era um PC normal, com "reduzir movimento" ligado, ficando sem
  // nenhum efeito — "o fundo do player não funciona". Agora a redução de
  // movimento só CONGELA a aurora (ver globals.css @media reduced-motion); o
  // vidro continua. A decisão de rebaixar fica só para hardware fraco de fato.
  const nucleos = nav.hardwareConcurrency ?? 0;
  const memoria = nav.deviceMemory ?? 0;

  // `0` significa "o navegador não conta" (Safari não expõe `deviceMemory`).
  // Nesse caso o sinal fica de fora em vez de contar como fraco: rebaixar todo
  // iPhone por falta de informação seria pior que o problema.
  if (nucleos > 0 && nucleos < NUCLEOS_MINIMOS) return true;
  if (memoria > 0 && memoria < MEMORIA_MINIMA) return true;
  return false;
}

/**
 * Carimba o resultado no `<html>` para o CSS decidir sozinho.
 *
 * Chamado uma vez no boot. Reavaliar depois não faria sentido: núcleo e memória
 * não mudam, e trocar o visual no meio da sessão chamaria mais atenção que o
 * travamento que se quer evitar.
 */
export function marcarDesempenho(): void {
  if (typeof document === 'undefined') return;
  if (dispositivoFraco()) document.documentElement.setAttribute('data-perf', 'baixo');
}
