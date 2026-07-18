import { describe, expect, it } from 'vitest';
import { alignLyrics, type AsrWord } from '@/lib/lyrics/align';

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
    expect(result?.[0]).toEqual({ timeMs: 1000, text: 'Hello darkness my old friend' });
    expect(result?.[1]).toEqual({ timeMs: 5000, text: 'I have come to talk again' });
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
