/**
 * PEDE À CDN A CAPA NO TAMANHO EM QUE ELA APARECE.
 *
 * O acervo guarda a capa no tamanho de gravadora: 3.030 da Apple em 600×600,
 * 509 da Deezer em 1000×1000, 1.108 do YouTube em `maxresdefault` (1280×720).
 * O navegador decodifica a imagem INTEIRA — 1000×1000 são 4 MB de RAM — mesmo
 * que o card tenha 160px. A Home monta ~15 carrosséis de até 20 capas, e no
 * celular isso somava centenas de megabytes em bitmap: a aba era morta pelo
 * sistema, que é o "quebra do nada".
 *
 * As três CDNs servem outros tamanhos pela própria URL, então basta reescrever.
 * Qualquer outra URL (data:, blob:, capa própria) passa intacta.
 */
export type TamanhoDeCapa = 'linha' | 'card';

const PX: Record<TamanhoDeCapa, number> = { linha: 160, card: 320 };

export function capaNoTamanho(
  url: string | null | undefined,
  tamanho: TamanhoDeCapa,
): string | null | undefined {
  if (!url || !url.startsWith('https://')) return url;
  const px = PX[tamanho];

  // Apple: .../600x600bb.jpg (também 1500x1500bb, 100x100bb-60…)
  if (url.includes('.mzstatic.com/')) {
    return url.replace(
      /\/\d{2,4}x\d{2,4}(bb|cc|sr)?(-\d+)?\.(jpg|jpeg|png|webp)$/i,
      `/${px}x${px}bb.jpg`,
    );
  }
  // Deezer: .../1000x1000-000000-80-0-0.jpg
  if (url.includes('dzcdn.net/')) {
    return url.replace(/\/\d{2,4}x\d{2,4}-/, `/${px}x${px}-`);
  }
  // YouTube: mqdefault é 320×180 SEM as tarjas pretas de hq/sddefault — o
  // recorte quadrado dele é 180×180, que cobre o card e a linha.
  if (url.includes('i.ytimg.com/')) {
    return url
      .replace('/vi_webp/', '/vi/')
      .replace(/\/(maxresdefault|sddefault|hqdefault|hq720)\.(jpg|webp)(\?.*)?$/, '/mqdefault.jpg');
  }
  return url;
}
