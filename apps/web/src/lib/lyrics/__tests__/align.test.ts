import { describe, expect, it } from 'vitest';
import {
  alignLinesToSegments,
  alignLyrics,
  spreadLinesOverSpan,
  type AsrSegment,
  type AsrWord,
} from '@/lib/lyrics/align';

/** Constrói palavras datadas a partir de "palavra@ms palavra@ms". */
function words(spec: string): AsrWord[] {
  return spec.split(/\s+/).map((chunk) => {
    const [text, ms] = chunk.split('@');
    return { text: text ?? '', startMs: Number(ms ?? 0) };
  });
}

describe('alignLyrics', () => {
  it('dá à linha o tempo da primeira palavra dela ouvida no áudio', () => {
    const result = alignLyrics(
      ['Hello darkness my old friend', 'I have come to talk again'],
      words(
        'hello@1000 darkness@1400 my@1800 old@2000 friend@2300 i@5000 have@5200 come@5400 to@5600 talk@5800 again@6000',
      ),
    );
    expect(result).not.toBeNull();
    expect(result?.[0]).toMatchObject({ timeMs: 1000, text: 'Hello darkness my old friend' });
    expect(result?.[1]).toMatchObject({ timeMs: 5000, text: 'I have come to talk again' });
  });

  it('carimba CADA palavra, não só a linha — é o que o karaokê segue', () => {
    const result = alignLyrics(
      ['Hello darkness my old friend'],
      words('hello@1000 darkness@1400 my@1800 old@2000 friend@2300'),
    );
    expect(result?.[0]?.words).toEqual([
      { text: 'Hello', timeMs: 1000 },
      { text: 'darkness', timeMs: 1400 },
      { text: 'my', timeMs: 1800 },
      { text: 'old', timeMs: 2000 },
      { text: 'friend', timeMs: 2300 },
    ]);
  });

  it('palavra que o ASR comeu ganha tempo interpolado entre as vizinhas', () => {
    // O ASR não ouviu "my": ela não pode empilhar no começo da linha nem
    // herdar o tempo da seguinte — cai no meio, onde de fato foi cantada.
    const result = alignLyrics(
      ['Hello darkness my old friend'],
      words('hello@1000 darkness@1400 old@2000 friend@2300'),
    );
    const palavras = result?.[0]?.words;
    expect(palavras?.map((w) => w.text)).toEqual(['Hello', 'darkness', 'my', 'old', 'friend']);
    const my = palavras?.[2]?.timeMs ?? 0;
    expect(my).toBeGreaterThan(1400);
    expect(my).toBeLessThan(2000);
  });

  it('o tempo das palavras nunca anda para trás dentro da linha', () => {
    const result = alignLyrics(
      ['uma duas tres quatro cinco'],
      words('uma@1000 duas@900 tres@1200 quatro@1100 cinco@1500'),
    );
    const tempos = result?.[0]?.words?.map((w) => w.timeMs) ?? [];
    for (let i = 1; i < tempos.length; i += 1) {
      expect(tempos[i]!).toBeGreaterThanOrEqual(tempos[i - 1]!);
    }
  });

  it('mantém o TEXTO da letra, não o que o ASR ouviu errado', () => {
    // O ASR ouviu "sound of silence" como "sound of violence" — o texto certo
    // vem da letra; do ASR aproveitamos só o relógio.
    const result = alignLyrics(
      ['The sound of silence'],
      words('the@800 sound@1000 of@1200 violence@1400'),
    );
    expect(result?.[0]?.text).toBe('The sound of silence');
    expect(result?.[0]?.timeMs).toBe(800);
  });

  it('tolera palavras que o ASR pulou', () => {
    const result = alignLyrics(
      ['one two three four five'],
      words('one@100 three@300 five@500'), // "two" e "four" comidos
    );
    expect(result?.[0]?.timeMs).toBe(100);
  });

  it('interpola linhas que o ASR não reconheceu, sem empilhá-las no mesmo instante', () => {
    const result = alignLyrics(
      ['primeira linha', 'refrao inaudivel', 'terceira linha'],
      words('primeira@1000 linha@1200 terceira@5000 linha@5200'),
    );
    expect(result).not.toBeNull();
    const [a, b, c] = result ?? [];
    expect(a?.timeMs).toBe(1000);
    expect(c?.timeMs).toBe(5000);
    // A linha do meio precisa cair ENTRE as duas, não colada em nenhuma.
    expect(b?.timeMs).toBeGreaterThan(a?.timeMs ?? 0);
    expect(b?.timeMs).toBeLessThan(c?.timeMs ?? 0);
  });

  it('recusa o alinhamento quando o áudio é de outra música', () => {
    // Karaokê fora de tempo é pior que karaokê nenhum: melhor devolver null e
    // exibir a letra sem sincronia.
    const result = alignLyrics(
      ['completely different words here now'],
      words('nada@100 disso@300 bate@500 com@700 aquilo@900'),
    );
    expect(result).toBeNull();
  });

  it('ignora acento e pontuação ao comparar', () => {
    const result = alignLyrics(
      ['Coração partido, meu amor!'],
      words('coracao@2000 partido@2400 meu@2800 amor@3000'),
    );
    expect(result?.[0]?.timeMs).toBe(2000);
  });

  it('nunca devolve tempo andando para trás', () => {
    const result = alignLyrics(
      ['linha um', 'linha dois', 'linha tres'],
      // ASR bagunçado: "dois" datado depois de "tres"
      words('linha@1000 um@1100 linha@4000 tres@4100 linha@9000 dois@9100'),
    );
    const times = (result ?? []).map((l) => l.timeMs);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('devolve null sem letra ou sem áudio transcrito', () => {
    expect(alignLyrics([], words('a@0'))).toBeNull();
    expect(alignLyrics(['alguma coisa'], [])).toBeNull();
  });
});

// ── caminho pt-BR: tempo por LINHA (whisper não dá tempo por palavra) ──────────
describe('spreadLinesOverSpan', () => {
  it('a primeira linha começa no início da janela; os tempos crescem', () => {
    const out = spreadLinesOverSpan(['aaaa', 'bbbb', 'cccc'], 0, 30_000);
    expect(out[0]!.timeMs).toBe(0);
    expect(out[1]!.timeMs).toBeGreaterThan(out[0]!.timeMs);
    expect(out[2]!.timeMs).toBeGreaterThan(out[1]!.timeMs);
    expect(out[out.length - 1]!.timeMs).toBeLessThan(30_000);
  });

  it('linha mais longa recebe mais tempo (proporcional ao comprimento)', () => {
    // "a" curtíssima adianta muito a segunda; a longa empurra a terceira.
    const out = spreadLinesOverSpan(['a', 'palavra bem comprida aqui', 'fim'], 0, 10_000);
    expect(out[1]!.timeMs).toBeLessThan(1_000); // a curta quase não consome tempo
  });

  it('ignora linhas vazias e devolve lista vazia sem nada útil', () => {
    expect(spreadLinesOverSpan(['   ', ''], 0, 5_000)).toEqual([]);
  });
});

describe('alignLinesToSegments', () => {
  const seg = (text: string, startMs: number, endMs: number): AsrSegment => ({
    text,
    startMs,
    endMs,
  });

  it('reparte as linhas da letra entre as janelas do whisper, em ordem', () => {
    const out = alignLinesToSegments(
      ['linha um', 'linha dois', 'linha tres', 'linha quatro'],
      [seg('bla bla bla bla', 0, 30_000), seg('ble ble ble ble', 30_000, 60_000)],
    );
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(4);
    // texto vem da LETRA (confiável), não do ASR
    expect(out![0]!.text).toBe('linha um');
    // tempos não-decrescentes e dentro do total
    for (let i = 1; i < out!.length; i++) {
      expect(out![i]!.timeMs).toBeGreaterThanOrEqual(out![i - 1]!.timeMs);
    }
    // alguma linha cai na segunda janela (>=30s)
    expect(out!.some((l) => l.timeMs >= 30_000)).toBe(true);
    // sem tempo por palavra neste caminho
    expect(out![0]!.words).toBeUndefined();
  });

  it('descarta segmentos só instrumentais ("🎶") e devolve null sem material', () => {
    expect(alignLinesToSegments(['a', 'b'], [seg('🎶', 0, 30_000)])).toBeNull();
    expect(alignLinesToSegments([], [seg('tem texto', 0, 30_000)])).toBeNull();
  });
});
