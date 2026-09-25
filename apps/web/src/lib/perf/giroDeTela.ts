/**
 * GIRAR A TELA COMO NUM APP DA APPLE.
 *
 * Num app nativo do iPhone, girar o aparelho não "troca" a tela: o conteúdo
 * acompanha o movimento e ASSENTA na forma nova. Numa página, o sistema gira a
 * imagem e então o layout SALTA, de uma vez, de retrato para paisagem — a
 * prateleira que era coluna vira linha num quadro, sem transição nenhuma.
 *
 * O que dá para fazer, e o que não dá: a rotação de 90° o próprio iOS já anima
 * (ele gira a página inteira como gira qualquer app). Girar de novo por conta
 * própria somaria as duas e o conteúdo daria meia volta. O que falta é o
 * ASSENTAMENTO: quando o layout novo aparece, ele nasce um pouco reduzido e
 * translúcido e cresce até o lugar, na curva de mola que o iOS usa nas folhas
 * que sobem (`cubic-bezier(0.32, 0.72, 0, 1)`). O salto vira movimento.
 *
 * Só `transform` e `opacity` (ver `html[data-giro]` em globals.css): a
 * composição corre fora da thread principal e não repinta nada, então vale até
 * no modo leve. Some sob `prefers-reduced-motion`.
 *
 * Escuta a rotação DO APARELHO (`screen.orientation`), não a da janela: no
 * computador, arrastar a borda da janela até ela ficar mais alta que larga não
 * é girar nada, e não pode disparar animação. Onde o navegador não tem
 * `screen.orientation`, a troca retrato/paisagem vale só em tela de toque.
 */

/** Tempo da animação em `globals.css` + folga para ela terminar. */
const DURACAO_MS = 600;

let instalado = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function assentar(): void {
  const raiz = document.documentElement;
  // Reinicia a animação se o aparelho girar de novo no meio dela: tira o
  // atributo, força o reflow e põe de volta.
  raiz.removeAttribute('data-giro');
  void raiz.offsetWidth;
  raiz.setAttribute('data-giro', '');
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    raiz.removeAttribute('data-giro');
  }, DURACAO_MS);
}

export function instalarGiroDeTela(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;

  const orientacao = typeof screen !== 'undefined' ? screen.orientation : undefined;
  if (orientacao && typeof orientacao.addEventListener === 'function') {
    orientacao.addEventListener('change', assentar);
    return;
  }

  // Sem a API: retrato/paisagem, e só em tela de toque (ver o topo).
  const retrato = window.matchMedia('(orientation: portrait)');
  const toque = window.matchMedia('(pointer: coarse)');
  retrato.addEventListener('change', () => {
    if (toque.matches) assentar();
  });
}
