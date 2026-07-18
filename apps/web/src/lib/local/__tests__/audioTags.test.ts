import { describe, expect, it } from 'vitest';
import {
  mergeTags,
  parseId3v1,
  parseId3v2,
  readAudioTags,
  tagsAreEmpty,
  type AudioTags,
} from '@/lib/local/audioTags';

// ── construtores de bytes (o "arquivo" de mentira que alimenta o parser) ─────

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const latin1 = (s: string): Uint8Array =>
  Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));

/** Conteúdo de frame de texto: byte de encoding + valores separados por 0x00. */
const text = (encoding: number, ...values: string[]): Uint8Array => {
  const parts: Uint8Array[] = [Uint8Array.from([encoding])];
  values.forEach((v, i) => {
    if (i > 0) parts.push(Uint8Array.from([0]));
    if (encoding === 3) parts.push(utf8(v));
    else if (encoding === 1) {
      const le = new Uint8Array(v.length * 2);
      [...v].forEach((c, j) => {
        le[j * 2] = c.charCodeAt(0) & 0xff;
        le[j * 2 + 1] = c.charCodeAt(0) >> 8;
      });
      parts.push(concat(Uint8Array.from([0xff, 0xfe]), le));
    } else parts.push(latin1(v));
  });
  return concat(...parts);
};

/** Frame ID3v2.3 (id de 4 letras, tamanho uint32 comum). */
const frame23 = (id: string, payload: Uint8Array): Uint8Array => {
  const head = new Uint8Array(10);
  head.set(latin1(id), 0);
  const n = payload.length;
  head[4] = (n >>> 24) & 0xff;
  head[5] = (n >>> 16) & 0xff;
  head[6] = (n >>> 8) & 0xff;
  head[7] = n & 0xff;
  return concat(head, payload);
};

/** Frame ID3v2.2 (id de 3 letras, tamanho uint24). */
const frame22 = (id: string, payload: Uint8Array): Uint8Array => {
  const head = new Uint8Array(6);
  head.set(latin1(id), 0);
  const n = payload.length;
  head[3] = (n >>> 16) & 0xff;
  head[4] = (n >>> 8) & 0xff;
  head[5] = n & 0xff;
  return concat(head, payload);
};

/** Tag completa: cabeçalho "ID3" + versão + tamanho syncsafe + frames. */
const tag = (major: number, frames: Uint8Array[], padding = 0): Uint8Array => {
  const body = concat(...frames, new Uint8Array(padding));
  const head = new Uint8Array(10);
  head.set(latin1('ID3'), 0);
  head[3] = major;
  const n = body.length;
  head[6] = (n >>> 21) & 0x7f;
  head[7] = (n >>> 14) & 0x7f;
  head[8] = (n >>> 7) & 0x7f;
  head[9] = n & 0x7f;
  return concat(head, body);
};

/** APIC (v2.3): encoding + mime + tipo + descrição + bytes da imagem. */
const apic = (mime: string, type: number, image: Uint8Array): Uint8Array =>
  concat(
    Uint8Array.from([0]),
    latin1(mime),
    Uint8Array.from([0, type, 0]), // fim do mime, tipo de imagem, descrição vazia
    image,
  );

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// ── ID3v2 ───────────────────────────────────────────────────────────────────

describe('parseId3v2 — frames de texto', () => {
  it('lê título, artista, álbum, compositor, selo e ano', () => {
    const tags = parseId3v2(
      tag(3, [
        frame23('TIT2', text(3, 'Nadando Cem Os Tubarões')),
        frame23('TPE1', text(3, 'Charlie Brown Jr.')),
        frame23('TALB', text(3, 'Imunidade Musical')),
        frame23('TCOM', text(3, 'Chorão')),
        frame23('TPUB', text(3, 'EMI')),
        frame23('TYER', text(3, '2005')),
      ]),
    );
    expect(tags.title).toBe('Nadando Cem Os Tubarões');
    expect(tags.artist).toBe('Charlie Brown Jr.');
    expect(tags.album).toBe('Imunidade Musical');
    expect(tags.composer).toBe('Chorão');
    expect(tags.publisher).toBe('EMI');
    expect(tags.year).toBe(2005);
  });

  it('junta os vários valores de um frame v2.4 (compositores separados por NUL)', () => {
    const tags = parseId3v2(tag(4, [frame23('TCOM', text(3, 'Tom Jobim', 'Vinicius de Moraes'))]));
    expect(tags.composer).toBe('Tom Jobim, Vinicius de Moraes');
  });

  it('extrai só o ano de um TDRC com data completa', () => {
    expect(parseId3v2(tag(4, [frame23('TDRC', text(3, '2019-03-08T00:00'))])).year).toBe(2019);
  });

  it('decodifica UTF-16 com BOM (encoding 1)', () => {
    expect(parseId3v2(tag(3, [frame23('TIT2', text(1, 'Coração'))])).title).toBe('Coração');
  });

  it('decodifica latin1 (encoding 0)', () => {
    expect(parseId3v2(tag(3, [frame23('TPE1', text(0, 'Anitta'))])).artist).toBe('Anitta');
  });

  it('entende ID3v2.2 (ids de 3 letras)', () => {
    const tags = parseId3v2(
      tag(2, [frame22('TT2', text(0, 'Evidências')), frame22('TP1', text(0, 'Chitãozinho'))]),
    );
    expect(tags.title).toBe('Evidências');
    expect(tags.artist).toBe('Chitãozinho');
  });

  it('para no padding de zeros que fecha a tag', () => {
    const tags = parseId3v2(tag(3, [frame23('TIT2', text(3, 'Faixa'))], 64));
    expect(tags.title).toBe('Faixa');
  });
});

describe('parseId3v2 — capa embutida', () => {
  it('converte a APIC em data URL', () => {
    const tags = parseId3v2(tag(3, [frame23('APIC', apic('image/jpeg', 3, JPEG))]));
    expect(tags.coverDataUrl?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('prefere a capa frontal (tipo 3) a qualquer outra imagem embutida', () => {
    const outra = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const tags = parseId3v2(
      tag(3, [
        frame23('APIC', apic('image/png', 8, outra)), // "artista durante a gravação"
        frame23('APIC', apic('image/jpeg', 3, JPEG)), // capa de verdade
      ]),
    );
    expect(tags.coverDataUrl?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('ignora capa com mime que não é imagem', () => {
    const tags = parseId3v2(tag(3, [frame23('APIC', apic('text/html', 3, JPEG))]));
    expect(tags.coverDataUrl).toBeNull();
  });

  it('ignora capa grande demais para o registro', () => {
    const enorme = new Uint8Array(900 * 1024).fill(0xff);
    const tags = parseId3v2(tag(3, [frame23('APIC', apic('image/jpeg', 3, enorme))]));
    expect(tags.coverDataUrl).toBeNull();
  });
});

describe('parseId3v2 — robustez (tag malformada nunca lança)', () => {
  it('bytes que não são ID3 devolvem tags vazias', () => {
    expect(tagsAreEmpty(parseId3v2(Uint8Array.from([0xff, 0xfb, 0x90, 0x44])))).toBe(true);
  });

  it('buffer curto demais não quebra', () => {
    expect(tagsAreEmpty(parseId3v2(new Uint8Array(3)))).toBe(true);
  });

  it('frame com tamanho impossível é descartado sem lançar', () => {
    const bad = tag(3, [frame23('TIT2', text(3, 'ok'))]);
    bad[bad.length - 1 - 2] = 0x7f; // corrompe o corpo do último frame
    const quebrado = concat(
      bad.subarray(0, 10),
      latin1('TIT2'),
      Uint8Array.from([0x7f, 0xff, 0xff, 0xff, 0, 0]),
    );
    expect(() => parseId3v2(quebrado)).not.toThrow();
    expect(parseId3v2(quebrado).title).toBeNull();
  });

  it('versão desconhecida é ignorada em vez de chutada', () => {
    const futuro = tag(9, [frame23('TIT2', text(3, 'Faixa'))]);
    expect(parseId3v2(futuro).title).toBeNull();
  });
});

// ── ID3v1 e composição ──────────────────────────────────────────────────────

const v1 = (title: string, artist: string, album: string, year: string): Uint8Array => {
  const out = new Uint8Array(128);
  out.set(latin1('TAG'), 0);
  out.set(latin1(title), 3);
  out.set(latin1(artist), 33);
  out.set(latin1(album), 63);
  out.set(latin1(year), 93);
  return out;
};

describe('parseId3v1', () => {
  it('lê os campos de tamanho fixo', () => {
    const tags = parseId3v1(v1('Garota de Ipanema', 'João Gilberto', 'Getz/Gilberto', '1964'));
    expect(tags.title).toBe('Garota de Ipanema');
    expect(tags.artist).toBe('João Gilberto');
    expect(tags.album).toBe('Getz/Gilberto');
    expect(tags.year).toBe(1964);
  });

  it('bloco sem "TAG" devolve vazio', () => {
    expect(tagsAreEmpty(parseId3v1(new Uint8Array(128)))).toBe(true);
  });
});

describe('mergeTags', () => {
  it('o primeiro manda; o segundo só preenche buracos', () => {
    const v2: AudioTags = {
      title: 'Do ID3v2',
      artist: null,
      album: null,
      composer: 'Alguém',
      publisher: null,
      year: null,
      coverDataUrl: null,
    };
    const antigo = parseId3v1(v1('Do ID3v1', 'Artista', 'Álbum', '1998'));
    const merged = mergeTags(v2, antigo);
    expect(merged.title).toBe('Do ID3v2');
    expect(merged.artist).toBe('Artista');
    expect(merged.album).toBe('Álbum');
    expect(merged.composer).toBe('Alguém');
    expect(merged.year).toBe(1998);
  });
});

describe('readAudioTags', () => {
  it('lê a tag do início do "arquivo"', async () => {
    const bytes = concat(
      tag(3, [frame23('TIT2', text(3, 'Amanhã')), frame23('TPE1', text(3, 'Guilherme Arantes'))]),
      new Uint8Array(2048), // "áudio"
    );
    const tags = await readAudioTags(new Blob([bytes]));
    expect(tags.title).toBe('Amanhã');
    expect(tags.artist).toBe('Guilherme Arantes');
  });

  it('cai no ID3v1 do fim quando não há ID3v2', async () => {
    const bytes = concat(new Uint8Array(2048), v1('Legião', 'Renato Russo', 'Dois', '1986'));
    const tags = await readAudioTags(new Blob([bytes]));
    expect(tags.title).toBe('Legião');
    expect(tags.artist).toBe('Renato Russo');
  });

  it('arquivo sem tag nenhuma devolve vazio (o import segue pelo nome)', async () => {
    const tags = await readAudioTags(new Blob([new Uint8Array(4096)]));
    expect(tagsAreEmpty(tags)).toBe(true);
  });
});
