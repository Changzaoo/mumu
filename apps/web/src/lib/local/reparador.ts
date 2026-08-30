/**
 * O REPARADOR — pega o mapa das faixas que falharam e traz cada uma de volta.
 *
 * `faixasQueFalharam` responde "quais quebraram e quais têm conserto". Este
 * módulo é a outra metade: baixar de novo, da origem, o que dá para recuperar.
 * Sem ele o mapa seria só uma lista de queixas bem organizada.
 *
 * O CONSERTO É SEMPRE O MESMO GESTO. A causa quase sempre é a mesma: a cópia
 * daquela faixa foi podada do cofre (o cofre é menor que o acervo, e podar é
 * regime normal, não acidente), e o que sobrou foi uma entrada que promete som
 * e responde 404. O `sourceUrl` é o caminho de volta, e a fila de importação
 * que já existe sabe percorrê-lo — com retentativa, disjuntor e deduplicação
 * prontos. Reaproveitá-la é o que mantém este módulo pequeno.
 *
 * POR QUE ELE NÃO PEDE PERMISSÃO, AO CONTRÁRIO DO PESQUISADOR. O pesquisador
 * vem desligado de fábrica porque sai atrás de música que NINGUÉM pediu — gasta
 * internet e disco por conta própria, e isso tem de ser escolha explícita. Aqui
 * é o oposto: só se baixa faixa que a pessoa mandou tocar e que falhou na cara
 * dela. Não é surpresa, é a conclusão de um pedido que ela já fez.
 *
 * Ainda assim, com FREIO. O teto por rodada existe porque, no dia em que o
 * cofre podar muita coisa de uma vez, a lista de reparáveis pode ter centenas
 * de faixas — e despejar todas na fila viraria uma tempestade de download em
 * cima de quem só queria ouvir música. Poucas por vez, sempre; a lista não vai
 * a lugar nenhum.
 *
 * E ELE NÃO SE DECLARA VITORIOSO. Enfileirar não é consertar, e "o importador
 * disse que baixou" não é a mesma coisa que "a pessoa ouviu". Quem encerra um
 * caso é o player, quando sai som de verdade (`marcarReparada`, chamada com o
 * playhead já andando). Este módulo só empurra tentativas.
 */
import * as faixasQueFalharam from '@/lib/local/faixasQueFalharam';
import * as importQueue from '@/lib/local/importQueue';

/** Quantas faixas entram na fila por rodada. Ver "com FREIO" acima. */
const POR_RODADA = 3;
/** Tentativas por faixa antes de desistir — um vídeo removido nunca volta. */
const MAX_TENTATIVAS = 3;

const INTERVALO_MS = 20 * 60_000;
/**
 * A primeira rodada espera de propósito. Na abertura o app está baixando o
 * acervo, hidratando a biblioteca e tentando fazer sair a primeira música;
 * disputar banda com isso atrasaria exatamente o que a pessoa está esperando.
 */
const PRIMEIRA_MS = 5 * 60_000;

/**
 * Uma rodada de reparo. Devolve quantas faixas foram enfileiradas.
 *
 * Exportada e sem relógio próprio para poder ser testada direto, sem esperar
 * vinte minutos nem simular temporizador.
 */
export function repararUmaRodada(): number {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  // Fila pausada é um NÃO explícito, não um contratempo: 'auth' quer dizer que
  // a conta não tem acesso ao importador (retentar nunca resolve sozinho) e
  // 'backoff' quer dizer que ele já está mal. Empurrar mais itens nos dois
  // casos só engorda uma fila travada.
  if (importQueue.pauseReason() !== null) return 0;

  const candidatas = faixasQueFalharam.reparaveis(MAX_TENTATIVAS).slice(0, POR_RODADA);
  if (candidatas.length === 0) return 0;

  const links: string[] = [];
  for (const caso of candidatas) {
    if (!caso.sourceUrl) continue;
    links.push(caso.sourceUrl);
    // A tentativa é anotada ANTES do resultado, e de propósito: se o registro
    // dependesse do sucesso, uma falha que trava a fila faria a mesma faixa ser
    // reenfileirada em toda rodada, para sempre.
    faixasQueFalharam.anotarTentativaDeReparo(caso.trackId);
  }
  if (links.length === 0) return 0;

  importQueue.enqueue(links);
  return links.length;
}

/** Liga o reparador. Devolve a função que o desliga. */
export function iniciarReparador(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let parado = false;

  const agendar = (ms: number): void => {
    if (parado) return;
    timer = setTimeout(rodar, ms);
  };

  const rodar = (): void => {
    if (parado) return;
    try {
      repararUmaRodada();
    } catch {
      // Um reparo que estoura não pode derrubar o app de quem está ouvindo.
    }
    agendar(INTERVALO_MS);
  };

  agendar(PRIMEIRA_MS);

  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
