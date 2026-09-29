/**
 * A DURAÇÃO DE UM MP3 LIDA DO CABEÇALHO — sem tocar e sem decodificar.
 *
 * Por que existe: um terço do acervo chegou com `durationMs` zerado. A faixa
 * importada pelo servidor nascia com `0` de propósito ("o aparelho mede quando
 * tocar"), e faixa que ninguém toca nunca era medida — a lista mostrava "0:00"
 * para sempre. E o dado estava no próprio arquivo o tempo todo.
 *
 * Todo MP3 que o importador produz sai do ffmpeg/LAME, que grava no PRIMEIRO
 * quadro um cabeçalho `Info` (CBR) ou `Xing` (VBR) com o número exato de
 * quadros. Quadros × amostras por quadro ÷ taxa de amostragem é a duração
 * exata — não uma estimativa. Por isso bastam os primeiros KB do arquivo (mais
 * a etiqueta ID3 com a capa, que vem antes do áudio).
 *
 * Só na falta desse cabeçalho cai para tamanho × bitrate, que é exato em CBR e
 * aproximado em VBR sem cabeçalho (raro: nenhum encoder atual deixa de gravar).
 *
 * `null` quer dizer "não sei" — arquivo que não é MP3, bytes insuficientes,
 * cabeçalho podre. Quem chama nunca deve transformar isso em `0` gravado.
 */

/** Tamanho da etiqueta ID3v2 no começo (0 se não há). Precisa de 10 bytes. */
export function tamanhoDoId3(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  // Tamanho "synchsafe": 7 bits úteis por byte.
  const corpo =
    ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  const rodape = b[5]! & 0x10 ? 10 : 0;
  return 10 + corpo + rodape;
}

const BITRATES: Record<string, number[]> = {
  // [versão MPEG 1|2][camada] → kbps por índice (0 = livre, 15 = inválido)
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

interface Quadro {
  /** 1 = MPEG-1; 2 = MPEG-2 e 2.5 (mesmas tabelas). */
  versao: 1 | 2;
  mpeg25: boolean;
  camada: 1 | 2 | 3;
  kbps: number;
  taxa: number;
  amostras: number;
  mono: boolean;
  tamanho: number;
}

function lerQuadro(b: Uint8Array, i: number): Quadro | null {
  if (i + 4 > b.length) return null;
  const b1 = b[i + 1]!;
  const b2 = b[i + 2]!;
  const b3 = b[i + 3]!;
  if (b[i] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const v = (b1 >> 3) & 3; // 0 = 2.5, 1 = reservado, 2 = MPEG-2, 3 = MPEG-1
  const l = (b1 >> 1) & 3; // 1 = III, 2 = II, 3 = I, 0 = reservado
  if (v === 1 || l === 0) return null;
  const idxBitrate = b2 >> 4;
  const idxTaxa = (b2 >> 2) & 3;
  if (idxBitrate === 0 || idxBitrate === 15 || idxTaxa === 3) return null;
  const versao: 1 | 2 = v === 3 ? 1 : 2;
  const camada = (4 - l) as 1 | 2 | 3;
  const kbps = BITRATES[`${versao}-${camada}`]![idxBitrate]!;
  const base = [44100, 48000, 32000][idxTaxa]!;
  const taxa = v === 3 ? base : v === 2 ? base / 2 : base / 4;
  const amostras = camada === 1 ? 384 : camada === 2 ? 1152 : versao === 1 ? 1152 : 576;
  const enchimento = (b2 >> 1) & 1;
  const tamanho =
    camada === 1
      ? (Math.floor((12 * kbps * 1000) / taxa) + enchimento) * 4
      : Math.floor(((amostras / 8) * kbps * 1000) / taxa) + enchimento;
  if (tamanho < 24) return null;
  return { versao, mpeg25: v === 0, camada, kbps, taxa, amostras, mono: b3 >> 6 === 3, tamanho };
}

function u32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
}

function texto(b: Uint8Array, i: number, n: number): string {
  let s = '';
  for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]!);
  return s;
}

/** Duração plausível de uma faixa: um segundo a seis horas. Fora disso é lixo. */
function plausivel(ms: number): number | null {
  return Number.isFinite(ms) && ms >= 1000 && ms <= 6 * 3600_000 ? Math.round(ms) : null;
}

/**
 * Duração em ms a partir de um TRECHO do arquivo.
 *
 * @param b       bytes a partir de `inicio` no arquivo (idealmente do começo).
 * @param total   tamanho do arquivo inteiro — só usado no caminho do bitrate.
 * @param inicio  deslocamento de `b` dentro do arquivo (quando a etiqueta ID3
 *                foi pulada numa segunda leitura).
 */
export function duracaoDoMp3(b: Uint8Array, total: number, inicio = 0): number | null {
  const id3 = inicio === 0 ? tamanhoDoId3(b) : 0;
  // Procura o primeiro quadro CONFIRMADO: um 0xFF seguido de bits certos
  // aparece por acaso dentro de lixo; exigir que o quadro seguinte também
  // comece onde o primeiro diz que acaba elimina esse falso positivo.
  const limite = Math.min(b.length - 4, id3 + 64 * 1024);
  for (let i = id3; i < limite; i++) {
    const q = lerQuadro(b, i);
    if (!q) continue;
    const prox = i + q.tamanho;
    if (prox + 4 <= b.length && !lerQuadro(b, prox)) continue;

    // Xing/Info: logo depois das "side info" do primeiro quadro.
    const lateral = q.versao === 1 ? (q.mono ? 17 : 32) : q.mono ? 9 : 17;
    const x = i + 4 + lateral;
    const marca = texto(b, x, 4);
    if ((marca === 'Xing' || marca === 'Info') && x + 12 <= b.length) {
      const flags = u32(b, x + 4);
      if (flags & 1) {
        const quadros = u32(b, x + 8);
        if (quadros > 0) return plausivel((quadros * q.amostras * 1000) / q.taxa);
      }
    }
    // VBRI (encoder da Fraunhofer): posição fixa, 32 bytes após o cabeçalho.
    if (texto(b, i + 36, 4) === 'VBRI' && i + 36 + 18 <= b.length) {
      const quadros = u32(b, i + 36 + 14);
      if (quadros > 0) return plausivel((quadros * q.amostras * 1000) / q.taxa);
    }
    // Sem cabeçalho: tamanho do áudio ÷ bitrate (exato em CBR).
    const audio = total - (inicio + i);
    if (!(audio > 0)) return null;
    return plausivel((audio * 8) / q.kbps);
  }
  return null;
}
