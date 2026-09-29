/**
 * A REDE ESTÁ MORTA? — `navigator.onLine` não sabe responder isso.
 *
 * No Android (e no WebView do app) `onLine` diz se existe uma INTERFACE de rede,
 * não se a internet chega: dados móveis ligados sem sinal, Wi-Fi de ônibus sem
 * saída, pacote de dados acabado — tudo isso é `onLine === true`. O player
 * confiava nele para decidir "sem rede, vou para as baixadas", e com ele
 * mentindo o que acontecia era o contrário: cada faixa que não estava no
 * aparelho esperava o watchdog inteiro (18 a 60 s) e, se travasse no meio,
 * ficava esperando a rede PARA SEMPRE no mesmo ponto, com músicas baixadas
 * logo adiante na fila.
 *
 * Este módulo dá a resposta de verdade quando ela importa: uma sonda curta ao
 * próprio site. Qualquer resposta HTTP (até um 404) prova que a rede chega;
 * só exceção ou demora além do teto provam que não.
 *
 * Quem pergunta: o player, e SÓ quando há o que ganhar — existe uma faixa
 * baixada adiante e a atual depende da rede. Com a rede boa a sonda custa um
 * HEAD de um arquivo minúsculo; sem ela, custa no máximo o teto abaixo, que é
 * uma fração do watchdog que ela substitui.
 */

/**
 * Por quanto tempo um veredito vale antes de perguntar de novo. Precisa cobrir
 * a distância entre a sonda feita perto do fim da faixa (até ~38s antes, com
 * rede lenta) e o instante da troca, senão a troca pergunta de novo no escuro.
 * O evento `online` do navegador invalida antes disso.
 */
const VALIDADE_MS = 45_000;
/**
 * Teto da sonda. A rede de celular ruim mas VIVA responde um HEAD bem antes
 * disto; passar daqui é o mesmo que não chegar, do ponto de vista de quem está
 * ouvindo silêncio.
 */
const TETO_DA_SONDA_MS = 4_000;

let veredito: { em: number; morta: boolean } | null = null;
let sondaEmCurso: Promise<boolean> | null = null;
let ouvindoEventos = false;

function ouvirEventosDoNavegador(): void {
  if (ouvindoEventos || typeof window === 'undefined') return;
  ouvindoEventos = true;
  // O navegador mudou de ideia sobre a rede: o que se sabia não vale mais.
  window.addEventListener('online', () => {
    veredito = null;
  });
  window.addEventListener('offline', () => {
    veredito = { em: Date.now(), morta: true };
  });
}

/** O navegador JÁ DISSE que não há rede (a única vez em que `onLine` não mente). */
export function semRedeDeclarada(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * O que se sabe AGORA, sem ir à rede: `true` se o navegador declara offline ou
 * se uma sonda recente não conseguiu sair do aparelho.
 */
export function redeSabidamenteMorta(): boolean {
  ouvirEventosDoNavegador();
  if (semRedeDeclarada()) return true;
  return veredito !== null && veredito.morta && Date.now() - veredito.em < VALIDADE_MS;
}

/**
 * Pergunta à rede de verdade (ou devolve o veredito recente). Nunca rejeita e
 * nunca demora mais que o teto: quem espera por isto é música parada.
 */
export function confirmarRedeMorta(): Promise<boolean> {
  ouvirEventosDoNavegador();
  if (semRedeDeclarada()) return Promise.resolve(true);
  if (veredito && Date.now() - veredito.em < VALIDADE_MS) return Promise.resolve(veredito.morta);
  sondaEmCurso ??= sondar()
    .then((morta) => {
      veredito = { em: Date.now(), morta };
      return morta;
    })
    .finally(() => {
      sondaEmCurso = null;
    });
  return sondaEmCurso;
}

async function sondar(): Promise<boolean> {
  if (typeof fetch !== 'function' || typeof location === 'undefined') return false;
  const ac = new AbortController();
  const teto = setTimeout(() => ac.abort(), TETO_DA_SONDA_MS);
  try {
    // A query única fura o precache do service worker (que responderia do
    // disco e fingiria rede) e qualquer cache HTTP no caminho.
    await Promise.race([
      fetch(`${location.origin}/robots.txt?rede=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: ac.signal,
      }),
      // Nem todo `fetch` respeita o sinal (dublês, WebViews antigos): o teto
      // vale de qualquer jeito.
      new Promise((_, rejeitar) => {
        ac.signal.addEventListener('abort', () => rejeitar(new Error('teto da sonda')));
      }),
    ]);
    return false;
  } catch {
    return true;
  } finally {
    clearTimeout(teto);
  }
}

/** Só para teste: esquece o veredito. */
export function esquecerVeredito(): void {
  veredito = null;
  sondaEmCurso = null;
}
