/**
 * ABRE A CONEXÃO ANTES DE PRECISAR DELA.
 *
 * Medido de fora, num desktop com fibra, pedindo o áudio de uma faixa de
 * catálogo ao Audius:
 *
 *   DNS               0,04 s
 *   TCP               0,25 s
 *   TLS               0,71 s
 *   primeiro byte     1,88 s   ← e o `/stream` do Audius ainda redireciona
 *
 * Ou seja: quase um segundo inteiro, ANTES de a música existir, é só apresentar
 * o navegador ao servidor. Num celular em rede móvel, com latência três a
 * quatro vezes maior, é vários segundos — e é um custo que o ouvinte paga
 * parado, olhando para o botão que acabou de apertar.
 *
 * `preconnect` faz esse aperto de mão enquanto a pessoa ainda está navegando.
 * Quando ela finalmente aperta o play, a conexão já está de pé e o pedido do
 * áudio sai na hora.
 *
 * NÃO É `prefetch`: nada de áudio é baixado aqui. Uma conexão ociosa custa
 * praticamente nada, e é por isso que só os DOIS hosts que servem áudio entram
 * — preconectar a lista toda gastaria bateria e sockets à toa.
 */

const jaPreconectados = new Set<string>();

function preconectar(url: string | null | undefined): void {
  if (!url || typeof document === 'undefined') return;
  let origem: string;
  try {
    origem = new URL(url).origin;
  } catch {
    return; // endereço relativo ou inválido: não há host para aquecer
  }
  if (jaPreconectados.has(origem)) return;
  jaPreconectados.add(origem);

  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origem;
  // O áudio é buscado com `crossOrigin = 'anonymous'` (ver AudioEngine). Uma
  // preconexão SEM esse atributo abre um socket de outra "pool" e o navegador
  // simplesmente não reaproveita — o aperto de mão seria feito duas vezes, e o
  // aquecimento não serviria para nada.
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

/**
 * Aquece os hosts de onde o áudio vem: o nó do Audius (catálogo) e o ajudante
 * de importação (faixas próprias). Chamado uma vez, no boot.
 */
export function preconectarFontesDeAudio(): void {
  if (typeof window === 'undefined') return;
  // Importes dinâmicos: nenhum destes módulos precisa entrar no caminho crítico
  // do boot só para que uma conexão seja aberta.
  void import('@/lib/catalog/audius')
    .then(({ audiusHost }) => preconectar(audiusHost()))
    .catch(() => undefined);
  void import('@/lib/local/importerHelper')
    .then(({ helperUrl }) => preconectar(helperUrl()))
    .catch(() => undefined);
}
