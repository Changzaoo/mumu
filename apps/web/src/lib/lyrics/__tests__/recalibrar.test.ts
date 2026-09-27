import { describe, expect, it } from 'vitest';
import {
  aplicarAlinhamento,
  recalibrarLetra,
  temposDasPalavras,
  transcricaoConfiavel,
  urlDoTempo,
} from '@/lib/lyrics/recalibrar';

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

const p = (text: string, startMs: number, prob = 0.9) => ({
  text,
  startMs,
  endMs: startMs + 200,
  prob,
});

describe('temposDasPalavras: o instante de cada palavra da tela', () => {
  it('pontuação e maiúscula não desalinham: casa por conteúdo', () => {
    const r = temposDasPalavras(
      'Mantém, mantém — vem mais',
      [p('Mantém', 1000), p('mantém', 1400), p('vem', 2000), p('mais', 2300)],
      1000,
      5000,
    )!;
    // "—" não é cantado: fica entre as vizinhas, sem empurrar as seguintes.
    expect(r.map((w) => w.text)).toEqual(['Mantém,', 'mantém', '—', 'vem', 'mais']);
    expect(r[3]!.timeMs).toBe(2000);
    expect(r[4]!.timeMs).toBe(2300);
  });

  it('palavra que o modelo mal achou é interpolada, não herda tempo errado', () => {
    const r = temposDasPalavras(
      'eu tô de volta',
      [p('eu', 1000), p('tô', 9000, 0.05), p('de', 1600), p('volta', 1900)],
      1000,
      4000,
    )!;
    expect(r[1]!.timeMs).toBeGreaterThan(1000);
    expect(r[1]!.timeMs).toBeLessThan(1600);
  });

  it('nunca sai do verso nem anda para trás', () => {
    const r = temposDasPalavras(
      'a b c d',
      [p('a', 1000), p('b', 1200), p('c', 1100), p('d', 99_000)],
      1000,
      3000,
    )!;
    const t = r.map((w) => w.timeMs);
    expect(t[0]).toBeGreaterThanOrEqual(1000);
    for (let i = 1; i < t.length; i += 1) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]!);
    expect(Math.max(...t)).toBeLessThan(3000);
  });

  it('poucas âncoras: devolve null e a tela estima por sílabas', () => {
    expect(temposDasPalavras('um dois três quatro', [p('um', 1000)], 1000, 4000)).toBeNull();
  });
});

describe('aplicarAlinhamento', () => {
  const letra = {
    synced: true,
    source: null,
    lines: [
      { timeMs: 17_000, text: 'Mantém, mantém' },
      { timeMs: 19_000, text: 'Vem mais, mais vem' },
      { timeMs: 21_000, text: 'Me traz mais cem' },
    ],
  };

  it('letra adiantada 11,6 s (Mantém): cada verso vai para onde a voz está', () => {
    const al = letra.lines.map((l) => ({
      startMs: l.timeMs + 11_600,
      endMs: l.timeMs + 13_000,
      words: l.text.split(' ').map((w, k) => p(w, l.timeMs + 11_600 + k * 300)),
    }));
    const r = aplicarAlinhamento(letra, [0, 1, 2], al)!;
    expect(r.lines.map((l) => l.timeMs)).toEqual([28_600, 30_600, 32_600]);
    expect(r.lines[1]!.words?.[1]).toEqual({ text: 'mais,', timeMs: 30_900 });
  });

  it('um verso mal alinhado (destoa das vizinhas) herda o deslocamento delas', () => {
    const al = [
      { startMs: 28_600, endMs: 29_000, words: [p('Mantém', 28_600), p('mantém', 28_900)] },
      {
        startMs: 5_000,
        endMs: 6_000,
        words: [p('Vem', 5_000), p('mais', 5_200), p('mais', 5_400), p('vem', 5_600)],
      },
      {
        startMs: 32_600,
        endMs: 33_000,
        words: [p('Me', 32_600), p('traz', 32_800), p('mais', 33_000), p('cem', 33_200)],
      },
    ];
    const r = aplicarAlinhamento(letra, [0, 1, 2], al)!;
    expect(r.lines[1]!.timeMs).toBe(30_600);
  });

  it('alinhamento sem confiança: não mexe', () => {
    const al = letra.lines.map((l) => ({
      startMs: l.timeMs,
      endMs: l.timeMs + 500,
      words: [p('x', l.timeMs, 0.01)],
    }));
    expect(aplicarAlinhamento(letra, [0, 1, 2], al)).toBeNull();
  });
});

describe('transcricaoConfiavel', () => {
  it('descarta o que o modelo não ouviu direito; se sobra pouco, não há letra', () => {
    const boas = Array.from({ length: 30 }, (_, i) => ({ text: 'a', startMs: i, prob: 0.9 }));
    expect(transcricaoConfiavel(boas)).toHaveLength(30);
    const ruins = Array.from({ length: 30 }, (_, i) => ({ text: 'a', startMs: i, prob: 0.3 }));
    expect(transcricaoConfiavel(ruins)).toBeNull();
  });
});
