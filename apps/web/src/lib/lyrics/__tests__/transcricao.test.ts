/**
 * Transcrição virando LETRA (não só cronômetro).
 *
 * A regra da casa é que o texto nunca vem do ASR — a letra publicada erra
 * menos. Ela continua valendo quando existe letra publicada. Mas para música
 * pouco conhecida o LRCLIB não tem nada, e a tela ficava vazia: aí a
 * transcrição é a única coisa entre o usuário e o nada.
 *
 * O que se testa aqui é o corte em versos: transcrição vem palavra a palavra,
 * letra se lê em linhas. Cortar errado transforma letra em parágrafo ilegível.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/importerHelper', () => ({ aiTranscribe: vi.fn() }));
vi.mock('@/lib/offline/audioCache', () => ({ getAudioBlob: vi.fn() }));
vi.mock('@/lib/local/localLibrary', () => ({ blobFor: vi.fn() }));
vi.mock('@/lib/lyrics/lyrics', () => ({
  cachedLyrics: vi.fn(),
  fetchLyrics: vi.fn(),
  writeLyrics: vi.fn(),
}));
vi.mock('@/lib/lyrics/align', () => ({ alignLyrics: vi.fn() }));

import { palavrasEmLinhas } from '@/lib/lyrics/syncFromAudio';

const p = (text: string, startMs: number): { text: string; startMs: number } => ({ text, startMs });

describe('palavrasEmLinhas', () => {
  it('corta o verso no respiro, não no meio da frase', () => {
    const linhas = palavrasEmLinhas([
      p('eu', 1000),
      p('vou', 1200),
      p('embora', 1400),
      // pausa de 1,6s = fim do verso
      p('mas', 3000),
      p('volto', 3200),
    ]);
    expect(linhas).toMatchObject([
      { timeMs: 1000, text: 'Eu vou embora' },
      { timeMs: 3000, text: 'Mas volto' },
    ]);
  });

  it('cada palavra guarda o tempo EXATO do ASR — sem interpolação', () => {
    // Aqui o tempo não é estimado: veio direto do reconhecedor. É a sincronia
    // mais precisa que o app consegue.
    const linhas = palavrasEmLinhas([p('eu', 1000), p('vou', 1200), p('embora', 1400)]);
    expect(linhas[0]!.words).toEqual([
      { text: 'Eu', timeMs: 1000 },
      { text: 'vou', timeMs: 1200 },
      { text: 'embora', timeMs: 1400 },
    ]);
  });

  it('não corta em pausa curta — cantar tem respiro pequeno o tempo todo', () => {
    const linhas = palavrasEmLinhas([p('nao', 0), p('me', 200), p('deixa', 500)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.text).toBe('Nao me deixa');
  });

  it('corta por tamanho quando ninguém respira (canto contínuo)', () => {
    const words = Array.from({ length: 20 }, (_, i) => p(`w${i}`, i * 100));
    const linhas = palavrasEmLinhas(words);
    // 9 palavras por linha no máximo — senão a "letra" vira um parágrafo.
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.text.split(' ').length).toBeLessThanOrEqual(9);
  });

  it('o tempo da linha é o da PRIMEIRA palavra — é nela que o karaokê acende', () => {
    const linhas = palavrasEmLinhas([p('vem', 5000), p('ca', 5200)]);
    expect(linhas[0]!.timeMs).toBe(5000);
  });

  it('descarta palavra vazia sem deixar espaço duplo', () => {
    const linhas = palavrasEmLinhas([p('oi', 0), p('   ', 100), p('mundo', 200)]);
    expect(linhas[0]!.text).toBe('Oi mundo');
  });

  it('FRASES como a letra publicada, não cacos — com o que o reconhecedor ouviu de verdade', () => {
    // "Lembrei de Tu": palavras, pontuação e tempos reais do importador.
    const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
    const linhas = palavrasEmLinhas([
      w('Lembrei', 780, 1440),
      w('de', 1440, 1600),
      w('tu,', 1600, 1940),
      w('confesso,', 2020, 2800),
      w('não', 2980, 3120),
      w('esqueci', 3120, 3540),
      w('nunca,', 3540, 4060),
      w('a', 4280, 4360),
      w('vida', 4360, 4460),
      w('mudou', 4460, 5080),
      w('a', 5080, 5400),
      w('ful', 5400, 5920),
      w('Eu', 5920, 6140),
      w('sigo', 6140, 6440),
    ]);
    expect(linhas.map((l) => l.text)).toEqual([
      'Lembrei de tu, confesso, não esqueci nunca',
      'A vida mudou a ful',
      'Eu sigo',
    ]);
    // O karaokê desenha as palavras: elas seguem a mesma limpeza da linha.
    expect(linhas[1]!.words![0]).toEqual({ text: 'A', timeMs: 4280 });
  });

  it('devolve lista vazia para entrada vazia em vez de uma linha em branco', () => {
    expect(palavrasEmLinhas([])).toEqual([]);
  });
});
