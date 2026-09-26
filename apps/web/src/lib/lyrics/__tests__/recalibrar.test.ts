import { describe, expect, it } from 'vitest';
import { recalibrarLetra, urlDoTempo } from '@/lib/lyrics/recalibrar';

/** Palavras do "áudio": cada verso começa em `inicio` e anda 300 ms por palavra. */
function audio(versos: Array<[number, string]>): Array<{ text: string; startMs: number }> {
  return versos.flatMap(([inicio, texto]) =>
    texto.split(' ').map((w, i) => ({ text: w, startMs: inicio + i * 300 })),
  );
}

const VERSOS = [
  'eu tô de volta com a mente de um chefe',
  'basta o meu verso e ela se derrete',
  'descarrego minha raiva no teclado',
  'sou o ceo não me chamo de rap',
  'fiz detox do haxixe',
];

describe('recalibrarLetra: a letra no relógio do áudio', () => {
  it('corrige letra ADIANTADA e com DERIVA (a que acaba antes da música)', () => {
    // No áudio os versos vêm a cada 5 s a partir de 10 s; a letra publicada
    // começa 1 s adiantada e vai encurtando (4 s por verso).
    const real = VERSOS.map((v, i): [number, string] => [10_000 + i * 5_000, v]);
    const publicada = {
      synced: true,
      source: null,
      lines: VERSOS.map((text, i) => ({ timeMs: 9_000 + i * 4_000, text })),
    };
    const r = recalibrarLetra(publicada, audio(real))!;
    expect(r.lines.map((l) => l.timeMs)).toEqual(real.map(([t]) => t));
    // Com o tempo real de cada palavra.
    expect(r.lines[0]!.words?.[1]).toEqual({ text: 'tô', timeMs: 10_300 });
  });

  it('verso que o áudio não reconheceu herda o deslocamento das vizinhas', () => {
    const real = VERSOS.map((v, i): [number, string] => [10_000 + i * 5_000, v]);
    // O ASR "comeu" o terceiro verso inteiro.
    const palavras = audio(real.filter((_, i) => i !== 2));
    const publicada = {
      synced: true,
      source: null,
      lines: VERSOS.map((text, i) => ({ timeMs: 9_000 + i * 5_000, text })),
    };
    const r = recalibrarLetra(publicada, palavras)!;
    // Vizinhas deslocadas +1 s → o verso sem âncora também vai +1 s.
    expect(r.lines[2]!.timeMs).toBe(20_000);
  });

  it('letra SEM tempo ganha tempo', () => {
    const real = VERSOS.map((v, i): [number, string] => [3_000 + i * 4_000, v]);
    const plana = {
      synced: false,
      source: null,
      lines: VERSOS.map((text) => ({ timeMs: 0, text })),
    };
    const r = recalibrarLetra(plana, audio(real))!;
    expect(r.synced).toBe(true);
    expect(r.lines.map((l) => l.timeMs)).toEqual(real.map(([t]) => t));
  });

  it('áudio de OUTRA música: não mexe (karaokê errado é pior)', () => {
    const outra = audio([[0, 'completely different words about something else entirely here']]);
    const publicada = {
      synced: true,
      source: null,
      lines: VERSOS.map((text, i) => ({ timeMs: i * 4_000, text })),
    };
    expect(recalibrarLetra(publicada, outra)).toBeNull();
  });

  it('monta a URL do relógio a partir da cópia no cofre', () => {
    expect(urlDoTempo('https://importer.x/blob/local%3Aabc?k=123', 'pt')).toBe(
      'https://importer.x/blob/local%3Aabc/tempo?k=123&lang=pt',
    );
    expect(urlDoTempo('https://importer.x/stream?url=y', 'pt')).toBeNull();
  });
});
