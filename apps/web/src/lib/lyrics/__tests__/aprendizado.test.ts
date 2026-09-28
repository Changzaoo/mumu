/**
 * O que a transcrição ERROU vs. o que a letra CONFIRMADA diz — os pares que
 * viram vocabulário do artista no importador (ver vocabulario.mjs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extrairCorrecoes } from '@/lib/lyrics/aprendizado';

// `vi.hoisted` garante que a fábrica do mock enxergue `enviarAprendizadoDeLetra`
// mesmo com o `import` de aprendizado.ts (que importa o módulo mockado) antes
// dela no arquivo — sem isto, a leitura cai em "before initialization".
const { enviarAprendizadoDeLetra } = vi.hoisted(() => ({
  enviarAprendizadoDeLetra: vi.fn(async () => undefined),
}));
vi.mock('@/lib/local/importerHelper', () => ({ enviarAprendizadoDeLetra }));

describe('extrairCorrecoes: alinha o ouvido contra o real e devolve as divergências', () => {
  it('frase que virou outra palavra ("a ful" → "afu")', () => {
    const r = extrairCorrecoes(['a', 'vida', 'mudou', 'a', 'ful'], ['a', 'vida', 'mudou', 'afu']);
    expect(r).toEqual([{ ouvido: 'a ful', real: 'afu' }]);
  });

  it('uma palavra por outra ("sol" → "Sul"), mantém o resto igual', () => {
    const r = extrairCorrecoes(['pela', 'sol'], ['pela', 'Sul']);
    expect(r).toEqual([{ ouvido: 'sol', real: 'Sul' }]);
  });

  it('sequências idênticas: nenhuma correção', () => {
    expect(extrairCorrecoes(['mantém', 'mantém'], ['mantém', 'mantém'])).toEqual([]);
  });

  it('só acento/caixa diferentes: não é correção nenhuma', () => {
    expect(extrairCorrecoes(['MANTEM'], ['Mantém'])).toEqual([]);
  });

  it('palavra extra ouvida (o modelo inventou): não gera correção (só remoção, sem substituto)', () => {
    const r = extrairCorrecoes(['eu', 'tô', 'bem', 'de', 'volta'], ['eu', 'tô', 'de', 'volta']);
    expect(r).toEqual([]);
  });

  it('palavra que faltou ouvir (só inserção do lado real): não gera correção', () => {
    const r = extrairCorrecoes(['eu', 'de', 'volta'], ['eu', 'tô', 'de', 'volta']);
    expect(r).toEqual([]);
  });

  it('divergência grande demais (mais de 3 palavras de um lado): descartada', () => {
    const r = extrairCorrecoes(
      ['um', 'dois', 'tres', 'quatro', 'cinco'],
      ['a', 'b', 'c', 'd', 'e'],
    );
    expect(r).toEqual([]);
  });

  it('duas correções na mesma música, separadas por trecho igual', () => {
    const r = extrairCorrecoes(
      ['pela', 'sol', 'eu', 'vim', 'a', 'ful'],
      ['pela', 'Sul', 'eu', 'vim', 'afu'],
    );
    expect(r).toEqual([
      { ouvido: 'sol', real: 'Sul' },
      { ouvido: 'a ful', real: 'afu' },
    ]);
  });

  it('sequência vazia de qualquer lado: nada a comparar', () => {
    expect(extrairCorrecoes([], ['a'])).toEqual([]);
    expect(extrairCorrecoes(['a'], [])).toEqual([]);
  });
});

describe('aprenderComATranscricao: manda o aprendizado best-effort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sem artista conhecido: não manda nada', async () => {
    const { aprenderComATranscricao } = await import('@/lib/lyrics/aprendizado');
    aprenderComATranscricao(undefined, [{ text: 'a ful' }], [{ text: 'afu' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(enviarAprendizadoDeLetra).not.toHaveBeenCalled();
  });

  it('cabeçalho de seção ("[Refrão]") não entra como texto da letra', async () => {
    const { aprenderComATranscricao } = await import('@/lib/lyrics/aprendizado');
    aprenderComATranscricao(
      'Matuê',
      [{ text: 'pela sol' }],
      [{ text: '[Refrão]' }, { text: 'pela Sul' }],
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(enviarAprendizadoDeLetra).toHaveBeenCalledWith('Matuê', [
      { ouvido: 'sol', real: 'Sul' },
    ]);
  });

  it('nenhuma correção encontrada: não manda nada', async () => {
    const { aprenderComATranscricao } = await import('@/lib/lyrics/aprendizado');
    aprenderComATranscricao('Matuê', [{ text: 'mantém mantém' }], [{ text: 'mantém mantém' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(enviarAprendizadoDeLetra).not.toHaveBeenCalled();
  });
});
