/**
 * Detector de duplicatas. Fundir é DESTRUTIVO e acontece sem o usuário ver, o
 * que torna o falso positivo muito mais caro que o falso negativo: deixar duas
 * cópias incomoda, apagar a música errada é perda. Boa parte dos testes aqui
 * cobre justamente o que ele NÃO pode fundir.
 */
import { describe, expect, it } from 'vitest';
import {
  agruparDuplicatas,
  limparTitulo,
  melhorEntrada,
  saoAMesma,
  semelhancaDeTitulo,
  type FaixaComparavel,
} from '../ai/duplicatas.js';

function f(over: Partial<FaixaComparavel> & { id: string }): FaixaComparavel {
  return {
    title: 'Evidências',
    artists: ['Chitãozinho & Xororó'],
    durationMs: 280_000,
    ...over,
  };
}

describe('limparTitulo', () => {
  it('tira o ruído de YouTube', () => {
    expect(limparTitulo('EVIDÊNCIAS (Official Music Video)')).toBe('evidencias');
    expect(limparTitulo('Evidências [Clipe Oficial]')).toBe('evidencias');
    expect(limparTitulo('Evidências (Ao Vivo)')).toBe('evidencias');
    expect(limparTitulo('Evidências | Som Livre')).toBe('evidencias');
    expect(limparTitulo('Evidências - Topic')).toBe('evidencias');
    expect(limparTitulo('Evidências #shorts')).toBe('evidencias');
  });

  it('não come o nome da música', () => {
    // "Vídeo" aqui é o nome da música, não o rótulo "(Official Video)" — a
    // limpeza só age dentro de parênteses/colchetes e em sufixos conhecidos.
    expect(limparTitulo('Vídeo Game')).toBe('video game');
    expect(limparTitulo('Coração de Aço')).toBe('coracao de aco');
    expect(limparTitulo('Ao Vivo é Outra Coisa')).toBe('ao vivo e outra coisa');
  });
});

describe('semelhancaDeTitulo', () => {
  it('compara por palavra, não por caractere', () => {
    expect(semelhancaDeTitulo('evidencias', 'evidencias')).toBe(1);
    expect(semelhancaDeTitulo('evidencias', 'sozinho')).toBe(0);
  });
});

describe('saoAMesma', () => {
  it('funde o mesmo clipe subido por dois canais', () => {
    const a = f({ id: '1', title: 'Evidências' });
    const b = f({ id: '2', title: 'EVIDENCIAS - Chitãozinho e Xororó (Official Video)' });
    // O título de b, limpo, tem "chitaozinho e xororo" a mais — mas todas as
    // palavras do menor ("evidencias") estão nele.
    expect(saoAMesma(a, b)).toContain('mesmo título limpo');
  });

  it('NÃO funde músicas diferentes do mesmo artista', () => {
    const a = f({ id: '1', title: 'Evidências' });
    const b = f({ id: '2', title: 'Sozinho' });
    expect(saoAMesma(a, b)).toBeNull();
  });

  it('NÃO funde o mesmo título de artistas diferentes (cover)', () => {
    const a = f({ id: '1', title: 'Evidências', artists: ['Chitãozinho & Xororó'] });
    const b = f({ id: '2', title: 'Evidências', artists: ['Lauana Prado'] });
    expect(saoAMesma(a, b)).toBeNull();
  });

  it('NÃO funde gravações de duração muito diferente (ao vivo vs. estúdio)', () => {
    const a = f({ id: '1', title: 'Evidências', durationMs: 280_000 });
    const b = f({ id: '2', title: 'Evidências (Ao Vivo)', durationMs: 340_000 });
    expect(saoAMesma(a, b)).toBeNull();
  });

  it('aceita crédito de feat a mais num dos lados', () => {
    const a = f({ id: '1', title: 'Imagina esse Cenário', artists: ['Veigh'] });
    const b = f({ id: '2', title: 'Imagina esse Cenário', artists: ['Veigh', 'Matuê'] });
    expect(saoAMesma(a, b)).not.toBeNull();
  });

  it('sem duração, exige DNA quase idêntico', () => {
    const dna = [1, 0, 0];
    const a = f({ id: '1', durationMs: null, dna });
    const b = f({ id: '2', durationMs: null, dna });
    expect(saoAMesma(a, b)).toContain('DNA');

    // DNA distante não funde nem com título igual.
    const c = f({ id: '3', durationMs: null, dna: [0, 1, 0] });
    expect(saoAMesma(a, c)).toBeNull();
  });

  it('DNA alto sozinho não basta — título tem que bater também', () => {
    const dna = [1, 0, 0];
    const a = f({ id: '1', title: 'Evidências', durationMs: null, dna });
    const b = f({ id: '2', title: 'Sozinho', durationMs: null, dna });
    expect(saoAMesma(a, b)).toBeNull();
  });

  it('nunca compara uma faixa com ela mesma', () => {
    const a = f({ id: '1' });
    expect(saoAMesma(a, a)).toBeNull();
  });
});

describe('melhorEntrada', () => {
  it('fica a mais completa', () => {
    const magra = f({ id: '1' });
    const cheia = f({ id: '2', coverUrl: 'x.jpg', album: 'Cow Boys' });
    expect(melhorEntrada(magra, cheia).id).toBe('2');
  });

  it('empate vai para a mais antiga — é ela que já está nas playlists', () => {
    const velha = f({ id: '1', addedAt: '2026-01-01T00:00:00Z' });
    const nova = f({ id: '2', addedAt: '2026-08-01T00:00:00Z' });
    expect(melhorEntrada(velha, nova).id).toBe('1');
    expect(melhorEntrada(nova, velha).id).toBe('1');
  });
});

describe('agruparDuplicatas', () => {
  it('junta três cópias num grupo só, mantendo uma', () => {
    const grupos = agruparDuplicatas([
      f({ id: '1', title: 'Evidências', addedAt: '2026-01-01T00:00:00Z' }),
      f({ id: '2', title: 'Evidências (Official Video)' }),
      f({ id: '3', title: 'EVIDENCIAS [Clipe Oficial]' }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.remover).toHaveLength(2);
    expect(grupos[0]!.manter.id).toBe('1');
  });

  it('agrupa por transitividade: se A=B e B=C, os três são um grupo', () => {
    // A e C nunca casam direto (título muito diferente), mas B liga os dois.
    const a = f({ id: 'a', title: 'Evidências' });
    const b = f({ id: 'b', title: 'Evidências ao vivo em Uberlândia' });
    const c = f({ id: 'c', title: 'Evidências ao vivo em Uberlândia (Official Video)' });
    const grupos = agruparDuplicatas([a, b, c]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.remover.length + 1).toBe(3);
  });

  it('biblioteca sem duplicata devolve nada', () => {
    const grupos = agruparDuplicatas([
      f({ id: '1', title: 'Evidências' }),
      f({ id: '2', title: 'Sozinho' }),
      f({ id: '3', title: 'Garota de Ipanema', artists: ['Tom Jobim'] }),
    ]);
    expect(grupos).toEqual([]);
  });

  it('uma faixa só nunca vira grupo', () => {
    expect(agruparDuplicatas([f({ id: '1' })])).toEqual([]);
  });
});
