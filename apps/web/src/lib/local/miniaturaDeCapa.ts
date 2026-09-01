/**
 * A CAPA GUARDADA VIRA MINIATURA — e por que isso não é economia de disco.
 *
 * A arte embutida num MP3 é do tamanho que o produtor gravou: 1000×1000,
 * 1400×1400, às vezes o JPEG de 2 MB que veio da gravadora. O app guardava esse
 * arquivo como veio e abria uma alça de blob por faixa. Numa biblioteca de
 * 5.000 faixas importadas isso é a conta inteira do problema:
 *
 *   5.000 capas × ~215 KB = ~1,1 GB de alças abertas com a aba PARADA
 *
 * Medido, não deduzido: `e2e/memoria.spec.ts` mostrou 1.000 faixas segurando
 * 219 MB de alças sem ninguém tocar em nada, e 1.500 capas segurando 328 MB —
 * linear no tamanho da biblioteca, que é o que faz a conta chegar no giga.
 *
 * E o disco é a menor parte. Onde a capa cheia dói mesmo é na DECODIFICAÇÃO:
 * um JPEG de 1200×1200 vira 5,8 MB de bitmap na memória do navegador quando
 * entra na tela, e não importa que ele esteja sendo exibido num quadrado de
 * 40px numa linha de lista. Trinta linhas visíveis são 170 MB de bitmap para
 * mostrar trinta selos do tamanho de uma unha.
 *
 * ── O TAMANHO ESCOLHIDO ──
 *
 * 320px de lado. O maior uso real da capa embutida na interface é o quadrado do
 * "tocando agora", que fica abaixo disso na esmagadora maioria das telas; em
 * tela grande a mesma imagem é usada BORRADA como fundo, onde a perda de nitidez
 * não é perceptível. Acima de 320 se paga memória por pixel que ninguém vê.
 *
 * WebP porque comprime bem melhor que JPEG neste tamanho; JPEG fica de reserva
 * para o navegador que não codifica WebP (o `toBlob` devolve PNG nesse caso, o
 * que seria pior que a capa original, então isso é conferido e não suposto).
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ──
 *
 * Não decide QUANDO encolher. Capa é enfeite, e enfeite jamais pode impedir uma
 * importação nem derrubar um boot: quem chama trata a falha devolvendo a capa
 * original. Uma capa grande é um problema; nenhuma capa é um problema pior.
 */

/** Lado máximo da miniatura guardada. Ver o cabeçalho para o porquê. */
export const LADO_DA_MINIATURA = 320;

/**
 * Abaixo disto não vale a pena reprocessar: o ganho não paga a decodificação,
 * e recomprimir uma imagem já pequena costuma piorar a qualidade sem devolver
 * bytes. Uma capa de 320px em WebP fica bem abaixo deste valor.
 */
export const BYTES_QUE_JA_ESTAO_BONS = 60_000;

/** Qualidade da recodificação. 0.82 é onde o artefato para de aparecer a 320px. */
const QUALIDADE = 0.82;

/**
 * Decodifica o blob sem passar por `<img>` quando dá.
 *
 * `createImageBitmap` decodifica FORA da thread principal — importante porque
 * este caminho roda em lote (a varredura que encolhe as capas antigas), e uma
 * decodificação síncrona por faixa devolveria à tela exatamente o travamento
 * que o resto do app passou rodadas eliminando.
 */
async function decodificar(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('capa ilegível'));
      img.src = url;
    });
  } finally {
    // A alça sai já: o bitmap decodificado não depende mais dela, e esquecê-la
    // aqui seria plantar o mesmo vazamento que este módulo veio consertar.
    URL.revokeObjectURL(url);
  }
}

function larguraAltura(fonte: ImageBitmap | HTMLImageElement): [number, number] {
  return fonte instanceof HTMLImageElement
    ? [fonte.naturalWidth, fonte.naturalHeight]
    : [fonte.width, fonte.height];
}

async function paraBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  tipo: string,
): Promise<Blob | null> {
  if (canvas instanceof HTMLCanvasElement) {
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, tipo, QUALIDADE);
    });
  }
  return await canvas.convertToBlob({ type: tipo, quality: QUALIDADE }).catch(() => null);
}

/**
 * Encolhe a capa para no máximo `LADO_DA_MINIATURA` de lado.
 *
 * Devolve o blob ORIGINAL quando encolher não ajudaria (já é pequeno, já é
 * pequeno em pixels, o navegador não sabe codificar, deu erro). Nunca devolve
 * null: quem chama não precisa de um caminho de exceção para um enfeite.
 */
export async function miniaturaDeCapa(original: Blob): Promise<Blob> {
  try {
    if (original.size <= BYTES_QUE_JA_ESTAO_BONS) return original;

    const fonte = await decodificar(original);
    const [largura, altura] = larguraAltura(fonte);
    if (!largura || !altura) return original;

    const escala = Math.min(1, LADO_DA_MINIATURA / Math.max(largura, altura));
    // Já cabe em 320px e mesmo assim está pesada: é arquivo mal comprimido, e
    // recodificar no MESMO tamanho ainda ganha bytes. Não se aumenta nunca.
    const w = Math.max(1, Math.round(largura * escala));
    const h = Math.max(1, Math.round(altura * escala));

    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return original;
    ctx.drawImage(fonte as CanvasImageSource, 0, 0, w, h);
    if (fonte instanceof ImageBitmap) fonte.close();

    let menor = await paraBlob(canvas, 'image/webp');
    // CONFERÊNCIA, e não suposição: um navegador sem codificador WebP não
    // reclama — ele devolve PNG calado. PNG de foto é MAIOR que o JPEG de onde
    // viemos, então trocar às cegas engordaria a capa em nome de encolhê-la.
    if (!menor || menor.type !== 'image/webp') {
      menor = await paraBlob(canvas, 'image/jpeg');
    }

    // Só troca se de fato ficou menor. Capa pequena e bem comprimida existe, e
    // nela o resultado da recodificação pode passar do original.
    if (!menor || menor.size >= original.size) return original;
    return menor;
  } catch {
    return original;
  }
}
