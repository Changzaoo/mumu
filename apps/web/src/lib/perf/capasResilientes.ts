/**
 * CAPA QUE NÃO CARREGA NÃO VIRA ÍCONE QUEBRADO — e volta sozinha quando a rede volta.
 *
 * O app desenha capa em dezenas de lugares (linha, player, fila, sidebar,
 * páginas) e só o `MediaCard` tratava o `onerror`. Nos outros, sem rede (ou
 * com o túnel do importador fora do ar), o navegador mostrava o ícone de
 * imagem quebrada — que a pessoa lê como "a capa corrompeu". E ficava assim
 * mesmo depois de a rede voltar, porque `<img>` não tenta de novo sozinho.
 *
 * Um ouvinte só, na fase de captura (o evento `error` de imagem não borbulha):
 *   1. a capa que falhou recebe um fundo neutro (SVG embutido, sem rede) e
 *      guarda a URL original em `data-capaOriginal`;
 *   2. quando a rede volta (`online`) ou a aba volta ao primeiro plano, cada
 *      uma é tentada de novo — uma vez por evento, sem laço.
 *
 * Não grava nada: capa quebrada é estado de tela, nunca de biblioteca. O
 * React continua dono do `src`: quando ele trocar a URL, o atributo guardado
 * some junto (ver `limparMarca`).
 */

const PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#1f1f22"/>' +
      '<path d="M26 20v18.5a5.5 5.5 0 1 1-3-4.9V24l16-4v12.5a5.5 5.5 0 1 1-3-4.9V17z" fill="#5b5b63"/>' +
      '</svg>',
  );

const MARCA = 'capaOriginal';
let instalado = false;

/** A capa de verdade que esta imagem tentou mostrar (ou null se não falhou). */
export function capaOriginalDe(img: HTMLImageElement): string | null {
  return img.dataset[MARCA] ?? null;
}

function limparMarca(img: HTMLImageElement): void {
  delete img.dataset[MARCA];
}

function aoFalhar(evento: Event): void {
  const img = evento.target;
  if (!(img instanceof HTMLImageElement)) return;
  const src = img.currentSrc || img.src;
  // O próprio placeholder falhando (não acontece; é embutido) ou `src` vazio:
  // nada a fazer. Blob revogado também cai aqui, e o placeholder serve.
  if (!src || src.startsWith('data:')) return;
  img.dataset[MARCA] = src;
  img.src = PLACEHOLDER;
}

/** Tenta de novo cada capa que falhou — o React não sabe que ela caiu. */
export function tentarCapasDeNovo(): number {
  if (typeof document === 'undefined') return 0;
  let tentadas = 0;
  for (const img of Array.from(document.images)) {
    const original = capaOriginalDe(img);
    if (!original) continue;
    // Blob de outra sessão nunca volta; só a rede volta.
    if (original.startsWith('blob:')) continue;
    limparMarca(img);
    tentadas += 1;
    img.src = original;
  }
  return tentadas;
}

export function instalarCapasResilientes(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  document.addEventListener('error', aoFalhar, true);
  window.addEventListener('online', () => {
    tentarCapasDeNovo();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) tentarCapasDeNovo();
  });
}
