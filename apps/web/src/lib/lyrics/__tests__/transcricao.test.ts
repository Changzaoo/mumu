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
      { timeMs: 1000, text: 'eu vou embora' },
      { timeMs: 3000, text: 'mas volto' },
    ]);
  });

  it('cada palavra guarda o tempo EXATO do ASR — sem interpolação', () => {
    // Aqui o tempo não é estimado: veio direto do reconhecedor. É a sincronia
    // mais precisa que o app consegue.
    const linhas = palavrasEmLinhas([p('eu', 1000), p('vou', 1200), p('embora', 1400)]);
    expect(linhas[0]!.words).toEqual([
      { text: 'eu', timeMs: 1000 },
      { text: 'vou', timeMs: 1200 },
      { text: 'embora', timeMs: 1400 },
    ]);
  });

  it('não corta em pausa curta — cantar tem respiro pequeno o tempo todo', () => {
    const linhas = palavrasEmLinhas([p('nao', 0), p('me', 200), p('deixa', 500)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.text).toBe('nao me deixa');
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
    expect(linhas[0]!.text).toBe('oi mundo');
  });

  it('devolve lista vazia para entrada vazia em vez de uma linha em branco', () => {
    expect(palavrasEmLinhas([])).toEqual([]);
  });
});
