/**
 * A duração sai do CABEÇALHO do MP3 — quadros contados pelo encoder, não
 * estimativa. Os arquivos aqui são montados byte a byte no formato que o
 * ffmpeg/LAME grava, para o teste não depender de um binário de áudio.
 */
import { describe, expect, it } from 'vitest';
import { duracaoDoMp3, tamanhoDoId3 } from '../utils/duracaoDoMp3.js';

/** MPEG-1 camada III, 128 kbps, 44,1 kHz, estéreo: quadros de 417 bytes. */
const CABECALHO = [0xff, 0xfb, 0x90, 0x00];
const QUADRO = 417;

function quadroVazio(): Uint8Array {
  const q = new Uint8Array(QUADRO);
  q.set(CABECALHO, 0);
  return q;
}

function quadroInfo(marca: 'Info' | 'Xing', quadros: number): Uint8Array {
  const q = quadroVazio();
  const x = 4 + 32; // depois das side info (MPEG-1 estéreo)
  q.set(
    [...marca].map((c) => c.charCodeAt(0)),
    x,
  );
  q.set([0, 0, 0, 0x0f], x + 4); // flags: quadros, bytes, TOC, qualidade
  q.set(
    [(quadros >>> 24) & 255, (quadros >>> 16) & 255, (quadros >>> 8) & 255, quadros & 255],
    x + 8,
  );
  return q;
}

function id3(corpo: number): Uint8Array {
  const t = new Uint8Array(10 + corpo);
  t.set([0x49, 0x44, 0x33, 4, 0, 0], 0);
  t.set([(corpo >> 21) & 0x7f, (corpo >> 14) & 0x7f, (corpo >> 7) & 0x7f, corpo & 0x7f], 6);
  return t;
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

describe('duracaoDoMp3', () => {
  it('lê os quadros do cabeçalho Info, pulando a capa embutida na ID3', () => {
    // 4 min: 240 s × 44100 / 1152 ≈ 9187,5 quadros.
    const arquivo = juntar(id3(5000), quadroInfo('Info', 9188), quadroVazio(), quadroVazio());
    const ms = duracaoDoMp3(arquivo, 50_000_000); // tamanho absurdo: não é usado
    expect(ms).toBe(Math.round((9188 * 1152 * 1000) / 44100));
    expect(Math.abs((ms ?? 0) - 240_000)).toBeLessThan(100);
  });

  it('VBR com Xing também', () => {
    const arquivo = juntar(quadroInfo('Xing', 1000), quadroVazio());
    expect(duracaoDoMp3(arquivo, 1)).toBe(Math.round((1000 * 1152 * 1000) / 44100));
  });

  it('sem cabeçalho de quadros, cai para tamanho ÷ bitrate', () => {
    const arquivo = juntar(id3(100), quadroVazio(), quadroVazio());
    // 3,2 MB de áudio a 128 kbps = 200 s.
    const total = 110 + 3_200_000;
    expect(duracaoDoMp3(arquivo, total)).toBe(200_000);
  });

  it('trecho lido DEPOIS da etiqueta (segunda leitura) usa o deslocamento', () => {
    const trecho = juntar(quadroVazio(), quadroVazio());
    expect(duracaoDoMp3(trecho, 1_000_000 + 3_200_000, 1_000_000)).toBe(200_000);
  });

  it('não é MP3 (ou só veio a etiqueta): não sabe — nunca inventa zero', () => {
    expect(duracaoDoMp3(new TextEncoder().encode('<html>não é áudio</html>'), 5000)).toBeNull();
    expect(duracaoDoMp3(id3(90_000).subarray(0, 4096), 10_000_000)).toBeNull();
    expect(duracaoDoMp3(new Uint8Array(0), 0)).toBeNull();
  });

  it('um 0xFF solto no lixo não passa por quadro', () => {
    const lixo = new Uint8Array(2000).fill(0x11);
    lixo.set(CABECALHO, 10); // parece quadro, mas não há outro onde ele acabaria
    expect(duracaoDoMp3(lixo, 2000)).toBeNull();
  });

  it('tamanho da etiqueta ID3 em synchsafe', () => {
    expect(tamanhoDoId3(id3(300_000))).toBe(300_010);
    expect(tamanhoDoId3(quadroVazio())).toBe(0);
  });
});
