/**
 * Leitor de TAGS EMBUTIDAS no próprio arquivo de áudio (ID3v2.2/2.3/2.4 e ID3v1).
 *
 * POR QUE existir: até aqui um arquivo solto só era identificado pelo NOME
 * ("Artista - Título.mp3"). Qualquer outro padrão — "01 faixa.mp3", "audio
 * (1).mp3", o nome que o WhatsApp inventa — virava artista "Desconhecido", e
 * sem artista o VERIFICADOR se recusa a procurar no catálogo (regra do JUIZ,
 * ver metaTeam.ts): a faixa ficava para sempre sem capa, álbum e gênero.
 *
 * Só que a esmagadora maioria dos arquivos JÁ CARREGA essa informação dentro
 * deles, escrita por quem produziu/rippou o arquivo. Ela é EVIDÊNCIA de fonte —
 * a mesma categoria dos metadados do yt-dlp — e não palpite. Por isso a tag
 * embutida entra ANTES do nome do arquivo na precedência do JUIZ.
 *
 * Escopo deliberadamente pequeno: ID3 (mp3) cobre o caso real do usuário.
 * Vorbis comments (flac/ogg) e átomos MP4 ficam de fora por enquanto — a
 * ausência degrada exatamente para o comportamento antigo (nome do arquivo).
 *
 * REGRA DE OURO deste módulo: tag malformada NUNCA lança e NUNCA trava. Todo
 * campo é opcional; na dúvida devolvemos null e a faixa segue o caminho antigo.
 */

export interface AudioTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Quem ESCREVEU a música (TCOM) — diferente do intérprete. */
  composer: string | null;
  /** Gravadora / selo (TPUB). */
  publisher: string | null;
  /** Ano de lançamento (TYER / TDRC), só o ano. */
  year: number | null;
  /** Capa embutida (APIC) como data URL — já limitada de tamanho. */
  coverDataUrl: string | null;
}

const EMPTY: AudioTags = {
  title: null,
  artist: null,
  album: null,
  composer: null,
  publisher: null,
  year: null,
  coverDataUrl: null,
};

/** Teto do que lemos do arquivo para achar a tag — ID3v2 fica sempre no início. */
const MAX_TAG_BYTES = 4 * 1024 * 1024;
/** Capa embutida acima disso não vai para o registro (localStorage tem quota). */
const MAX_COVER_BYTES = 800 * 1024;

// ── leitura de bytes ────────────────────────────────────────────────────────

/** Inteiro de 4 bytes "syncsafe" (7 bits úteis por byte) — tamanho de tag ID3v2. */
function syncsafe32(b: Uint8Array, at: number): number {
  return (
    ((b[at] ?? 0) & 0x7f) * 0x200000 +
    ((b[at + 1] ?? 0) & 0x7f) * 0x4000 +
    ((b[at + 2] ?? 0) & 0x7f) * 0x80 +
    ((b[at + 3] ?? 0) & 0x7f)
  );
}

function uint32(b: Uint8Array, at: number): number {
  return (
    (b[at] ?? 0) * 0x1000000 +
    (b[at + 1] ?? 0) * 0x10000 +
    (b[at + 2] ?? 0) * 0x100 +
    (b[at + 3] ?? 0)
  );
}

function uint24(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) * 0x10000 + (b[at + 1] ?? 0) * 0x100 + (b[at + 2] ?? 0);
}

/** Separador de valores dentro de um frame de texto ID3 (byte 0x00). */
const NUL = String.fromCharCode(0);
/** Byte-order mark que o UTF-16 deixa no texto decodificado. */
const BOM = String.fromCharCode(0xfeff);

/** ASCII cru — usado só para ids de frame e mime type, que são sempre ASCII. */
function ascii(b: Uint8Array, at: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(b[at + i] ?? 0);
  return out;
}

/**
 * Decodifica o texto de um frame conforme o byte de encoding do ID3
 * (0 = latin1, 1 = UTF-16 com BOM, 2 = UTF-16BE, 3 = UTF-8). Um encoding
 * desconhecido ou um TextDecoder indisponível cai em latin1 manual — pior
 * acentuação, nunca exceção.
 */
function decodeText(bytes: Uint8Array, encoding: number): string {
  const label =
    encoding === 3
      ? 'utf-8'
      : encoding === 1
        ? 'utf-16'
        : encoding === 2
          ? 'utf-16be'
          : 'windows-1252';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  }
}

/**
 * Conteúdo de um frame de texto: byte de encoding + valores separados por NUL
 * (o ID3v2.4 permite vários artistas/compositores no mesmo frame). Devolvemos
 * todos juntos — quem divide artistas é o splitArtistNames, não este módulo.
 */
function textFrame(data: Uint8Array): string | null {
  if (data.length < 2) return null;
  const raw = decodeText(data.subarray(1), data[0] ?? 0);
  const parts = raw
    .split(NUL)
    .map((p) => p.split(BOM).join('').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Primeiro ano de 4 dígitos dentro de um TYER/TDRC ("2019-03-08" → 2019). */
function yearFrom(value: string | null): number | null {
  const m = value ? /\b(1[89]\d{2}|20\d{2})\b/.exec(value) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/** Bytes → data URL, em blocos para não estourar a pilha com um spread gigante. */
function toDataUrl(mime: string, bytes: Uint8Array): string | null {
  try {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Mime de imagem aceito na capa — o resto é ignorado (defesa em profundidade). */
function safeImageMime(raw: string): string | null {
  const mime = raw.trim().toLowerCase();
  if (/^image\/(png|jpeg|jpg|webp|gif)$/.test(mime)) {
    return mime === 'image/jpg' ? 'image/jpeg' : mime;
  }
  // Encoders antigos escrevem só "JPG"/"PNG" (ID3v2.2 usa 3 letras fixas).
  if (mime === 'jpg' || mime === 'jpeg') return 'image/jpeg';
  if (mime === 'png') return 'image/png';
  return null;
}

/** Fim de uma string terminada em NUL, respeitando o par de bytes do UTF-16. */
function endOfString(data: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  if (!wide) {
    for (let i = from; i < data.length; i++) if (data[i] === 0) return i;
    return data.length;
  }
  for (let i = from; i + 1 < data.length; i += 2) {
    if (data[i] === 0 && data[i + 1] === 0) return i;
  }
  return data.length;
}

/** Capa embutida: APIC (v2.3/2.4) ou PIC (v2.2). Devolve null em qualquer dúvida. */
function pictureFrame(data: Uint8Array, v22: boolean): { type: number; url: string } | null {
  if (data.length < 6) return null;
  const encoding = data[0] ?? 0;
  let pos: number;
  let mime: string | null;
  if (v22) {
    mime = safeImageMime(ascii(data, 1, 3));
    pos = 4;
  } else {
    const mimeEnd = endOfString(data, 1, 0); // o mime é sempre latin1
    mime = safeImageMime(ascii(data, 1, mimeEnd - 1));
    pos = mimeEnd + 1;
  }
  if (!mime || pos >= data.length) return null;
  const type = data[pos] ?? 0;
  pos += 1;
  // Descrição — comprimento variável, terminada como o encoding manda.
  const descEnd = endOfString(data, pos, encoding);
  pos = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  if (pos >= data.length) return null;
  const image = data.subarray(pos);
  if (image.length === 0 || image.length > MAX_COVER_BYTES) return null;
  const url = toDataUrl(mime, image);
  return url ? { type, url } : null;
}

// ── ID3v2 ───────────────────────────────────────────────────────────────────

/** Ids de frame equivalentes entre v2.2 (3 letras) e v2.3/2.4 (4 letras). */
const TEXT_FRAMES: Record<string, keyof AudioTags> = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TALB: 'album',
  TAL: 'album',
  TCOM: 'composer',
  TCM: 'composer',
  TPUB: 'publisher',
  TPB: 'publisher',
};

const YEAR_FRAMES = new Set(['TYER', 'TYE', 'TDRC', 'TDRL', 'TORY']);

/**
 * Lê a tag ID3v2 de um bloco de bytes que COMEÇA nela. Puro e defensivo: para
 * de ler no primeiro frame inválido (é assim que se detecta o padding no fim
 * da tag) em vez de tentar adivinhar.
 */
export function parseId3v2(bytes: Uint8Array): AudioTags {
  const tags: AudioTags = { ...EMPTY };
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return tags;
  const major = bytes[3] ?? 0;
  if (major < 2 || major > 4) return tags; // versão futura: não arriscar palpite
  const flags = bytes[5] ?? 0;
  const end = Math.min(bytes.length, 10 + syncsafe32(bytes, 6));

  let pos = 10;
  // Cabeçalho estendido (opcional): v2.4 conta a si mesmo, v2.3 não.
  if (major >= 3 && (flags & 0x40) !== 0) {
    pos += major === 4 ? Math.max(10, syncsafe32(bytes, pos)) : 4 + uint32(bytes, pos);
  }

  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const headerLen = v22 ? 6 : 10;
  let cover: { type: number; url: string } | null = null;

  while (pos + headerLen <= end) {
    const id = ascii(bytes, pos, idLen);
    // Frame id só tem letras/números maiúsculos; qualquer outra coisa é o
    // padding de zeros que fecha a tag — parar aqui é o comportamento correto.
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size: number;
    if (v22) size = uint24(bytes, pos + 3);
    else if (major === 4) {
      // Vários encoders "v2.4" gravam o tamanho como uint32 comum. O bit alto
      // aceso denuncia isso — nesse caso o syncsafe daria um tamanho errado.
      const hasHighBit = [0, 1, 2, 3].some((i) => ((bytes[pos + 4 + i] ?? 0) & 0x80) !== 0);
      size = hasHighBit ? uint32(bytes, pos + 4) : syncsafe32(bytes, pos + 4);
    } else size = uint32(bytes, pos + 4);

    const dataStart = pos + headerLen;
    if (size <= 0 || dataStart + size > end) break; // tamanho impossível → tag truncada
    const data = bytes.subarray(dataStart, dataStart + size);

    const field = TEXT_FRAMES[id];
    if (field && field !== 'year' && field !== 'coverDataUrl') {
      tags[field] ??= textFrame(data);
    } else if (YEAR_FRAMES.has(id)) {
      tags.year ??= yearFrom(textFrame(data));
    } else if (id === 'APIC' || id === 'PIC') {
      const pic = pictureFrame(data, v22);
      // Tipo 3 = "front cover": é a capa de verdade e ganha de qualquer outra
      // imagem embutida (foto do artista, contracapa, ícone da gravadora).
      if (pic && (!cover || (pic.type === 3 && cover.type !== 3))) cover = pic;
    }
    pos = dataStart + size;
  }

  tags.coverDataUrl = cover?.url ?? null;
  return tags;
}

// ── ID3v1 (últimos 128 bytes) ───────────────────────────────────────────────

/** Campo de tamanho fixo do ID3v1, cortado no primeiro NUL e sem espaços. */
function v1Field(bytes: Uint8Array, at: number, len: number): string | null {
  const slice = bytes.subarray(at, at + len);
  const nul = slice.indexOf(0);
  const text = decodeText(nul >= 0 ? slice.subarray(0, nul) : slice, 0).trim();
  return text || null;
}

/**
 * Lê o bloco ID3v1 (exatamente 128 bytes, começando em "TAG"). Formato de 1996,
 * sem compositor nem capa — serve como rede de segurança para arquivos antigos.
 */
export function parseId3v1(bytes: Uint8Array): AudioTags {
  const tags: AudioTags = { ...EMPTY };
  if (bytes.length < 128 || ascii(bytes, 0, 3) !== 'TAG') return tags;
  tags.title = v1Field(bytes, 3, 30);
  tags.artist = v1Field(bytes, 33, 30);
  tags.album = v1Field(bytes, 63, 30);
  tags.year = yearFrom(v1Field(bytes, 93, 4));
  return tags;
}

/** Junta duas leituras: o que vier primeiro (ID3v2) manda; o resto preenche buracos. */
export function mergeTags(primary: AudioTags, fallback: AudioTags): AudioTags {
  return {
    title: primary.title ?? fallback.title,
    artist: primary.artist ?? fallback.artist,
    album: primary.album ?? fallback.album,
    composer: primary.composer ?? fallback.composer,
    publisher: primary.publisher ?? fallback.publisher,
    year: primary.year ?? fallback.year,
    coverDataUrl: primary.coverDataUrl ?? fallback.coverDataUrl,
  };
}

/** A leitura não encontrou NADA aproveitável? (evita trabalho a jusante) */
export function tagsAreEmpty(tags: AudioTags): boolean {
  return !tags.title && !tags.artist && !tags.album && !tags.composer && !tags.coverDataUrl;
}

// ── entrada pública (I/O) ───────────────────────────────────────────────────

/**
 * Lê as tags de um arquivo de áudio. Só toca os bytes necessários: o cabeçalho
 * diz o tamanho exato da tag ID3v2, e o ID3v1 são os últimos 128 bytes — nunca
 * carregamos um mp3 inteiro na memória. Qualquer falha devolve tags vazias.
 */
export async function readAudioTags(file: Blob): Promise<AudioTags> {
  try {
    let v2: AudioTags = { ...EMPTY };
    if (file.size > 10) {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (ascii(head, 0, 3) === 'ID3') {
        const total = Math.min(10 + syncsafe32(head, 6), MAX_TAG_BYTES, file.size);
        v2 = parseId3v2(new Uint8Array(await file.slice(0, total).arrayBuffer()));
      }
    }
    // ID3v1 só como tapa-buraco — o v2 é sempre mais completo e mais confiável.
    if (file.size > 128 && (!v2.title || !v2.artist || !v2.album)) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      return mergeTags(v2, parseId3v1(tail));
    }
    return v2;
  } catch {
    return { ...EMPTY };
  }
}
