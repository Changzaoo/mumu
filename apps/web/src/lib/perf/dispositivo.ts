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
 * ESTE APARELHO ESTÁ NO MODO LEVE?
 *
 * O rebaixamento existia só para o CSS: `data-perf="baixo"` desligava vidro,
 * desfoque e aurora, e o assunto terminava aí. Mas o que estrangula um celular
 * de entrada não é só o compositor — é o TRABALHO DE FUNDO. Na abertura sobem
 * onze subsistemas (sincronia, catálogo, fila, telemetria, presença, agente de
 * gênero, guardião offline, reparador, assimilador…), e todos rodavam na mesma
 * intensidade num aparelho de 2 GB e num desktop: quatro downloads simultâneos,
 * assimilação a cada 20s, classificação por IA. O app detectava a fraqueza e
 * respondia tirando a beleza, enquanto mantinha o peso.
 *
 * Esta função é a mesma decisão, legível por quem faz trabalho e não só por
 * folha de estilo. Lê o atributo em vez de recalcular de propósito: assim ela
 * concorda com o CSS por construção, e acompanha o monitor de quadros, que pode
 * rebaixar no meio da sessão depois de ver o travamento acontecer de verdade.
 *
 * É consultada A CADA RODADA, nunca no carregamento do módulo — senão o
 * rebaixamento tardio (o caso mais confiável, porque é medido) não teria efeito
 * nenhum sobre quem já tinha lido o valor.
 */
export function modoLeve(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-perf') === 'baixo';
}

/** Chave onde guardamos "este aparelho já provou que trava". */
const CHAVE_REBAIXADO = 'aurial:perf-baixo';

/** Aplica o modo leve agora e lembra dele para os próximos boots. */
function rebaixar(): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.getAttribute('data-perf') === 'baixo') return;
  document.documentElement.setAttribute('data-perf', 'baixo');
  try {
    window.localStorage.setItem(CHAVE_REBAIXADO, '1');
  } catch {
    /* quota — tudo bem, no máximo re-decide no próximo boot */
  }
}

/**
 * Carimba o resultado no `<html>` para o CSS decidir sozinho.
 *
 * Três fontes decidem, nesta ordem: (1) a MEMÓRIA de sessões passadas — se este
 * aparelho já travou uma vez, começa leve e nem tenta o vidro de novo; (2) a
 * heurística de hardware (núcleos/memória); (3) o monitor de quadros, que roda
 * depois e pega o que os dois primeiros não viram.
 */
export function marcarDesempenho(): void {
  if (typeof document === 'undefined') return;
  let lembrado = false;
  try {
    lembrado = window.localStorage.getItem(CHAVE_REBAIXADO) === '1';
  } catch {
    /* sem localStorage: cai na heurística */
  }
  if (lembrado || dispositivoFraco()) rebaixar();
}

/**
 * O QUE A HEURÍSTICA NÃO VÊ: o travamento de verdade.
 *
 * Núcleos e memória são um palpite grosseiro. Um celular com 4 núcleos e 4 GB
 * passa no teste e mesmo assim engasga rolando a lista, porque o custo do
 * `backdrop-filter` é da GPU/compositor, não da CPU — e disso o navegador não
 * conta nada. O jeito honesto de saber se trava é MEDIR os quadros.
 *
 * Um observador de `requestAnimationFrame` acompanha o intervalo entre quadros.
 * Enquanto está tudo fluido, não faz nada. Se acumular quadros longos de sobra
 * numa janela curta — sinal de rolagem engasgando, não de uma pausa isolada de
 * GC — rebaixa na hora e PARA de medir: a decisão é de mão única (nunca volta a
 * subir no meio da sessão, que seria pior que o travamento) e fica lembrada para
 * o próximo boot já nascer leve.
 *
 * Só roda em aparelho ainda NÃO rebaixado — quem já está no modo leve não tem o
 * que medir.
 */
export function monitorarDesempenho(): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  if (document.documentElement.getAttribute('data-perf') === 'baixo') return;

  // Um quadro a 60fps dura ~16,7ms. Acima de 50ms (menos de ~20fps) é engasgo
  // visível; abaixo disso pode ser só a tela em 30/45Hz ou uma variação boba.
  const QUADRO_RUIM = 50;
  // Quantos engasgos numa mesma janela deslizante bastam para condenar. Um só é
  // ruído (GC, uma imagem grande decodificando); um punhado seguido é travamento.
  const LIMITE = 8;
  // Tamanho da janela: engasgos velhos "expiram" para não somar uma pausa de
  // agora com outra de dez segundos atrás.
  const JANELA_MS = 4_000;

  // ATÉ QUANDO MEDIR. Antes o observador ficava ligado a SESSÃO INTEIRA: um
  // `requestAnimationFrame` acordando o app sessenta vezes por segundo, para
  // sempre, só para o caso de um engasgo aparecer na terceira hora de uso. Isso
  // é o próprio problema que ele veio diagnosticar — sessenta despertares por
  // segundo custam bateria e mantêm o navegador sem poder ociar a página.
  //
  // Meio minuto basta: no primeiro boot cabem a montagem da tela, a primeira
  // rolagem e a primeira reprodução, que é justamente onde o travamento
  // aparece. Se passou por isso liso, este aparelho aguenta.
  const DURACAO_MS = 30_000;

  let anterior = performance.now();
  const inicio = anterior;
  let ruins: number[] = [];

  const passo = (agora: number): void => {
    const delta = agora - anterior;
    anterior = agora;
    if (agora - inicio > DURACAO_MS) return; // passou no teste: para de medir

    // Só conta enquanto a aba está visível: aba em segundo plano tem rAF
    // estrangulado de propósito, e isso não é o usuário vendo travamento.
    if (!document.hidden && delta > QUADRO_RUIM) {
      ruins.push(agora);
      ruins = ruins.filter((t) => agora - t <= JANELA_MS);
      if (ruins.length >= LIMITE) {
        rebaixar();
        return; // condenado: para de medir
      }
    }
    requestAnimationFrame(passo);
  };

  requestAnimationFrame(passo);
}
