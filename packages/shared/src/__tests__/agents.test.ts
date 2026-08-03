import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  parseBatchGenres,
  parseDescription,
  parseSafety,
  parseTranslation,
  trackEmbeddingText,
  translateMessages,
} from '../ai/agents.js';
import { escalationFor, modelFor, CHAT_MODELS } from '../ai/models.js';

describe('parseSafety', () => {
  it('lê o JSON que o NemoGuard devolve de verdade', () => {
    // String exata observada em produção na sondagem de 2026-08-03.
    const real = '{"User Safety": "unsafe", "Safety Categories": "Violence, Profanity"} ';
    expect(parseSafety(real)).toEqual({
      explicit: true,
      categories: ['Violence', 'Profanity'],
    });
  });

  it('aceita safe sem categorias', () => {
    expect(parseSafety('{"User Safety": "safe"}')).toEqual({ explicit: false, categories: [] });
  });

  it('aceita a resposta em texto puro do modelo alternativo', () => {
    expect(parseSafety('User Safety: unsafe')).toEqual({ explicit: true, categories: [] });
  });

  it('devolve null quando não entendeu — rotular por engano esconde a faixa', () => {
    expect(parseSafety('não sei dizer')).toBeNull();
    expect(parseSafety('')).toBeNull();
  });
});

describe('parseBatchGenres', () => {
  it('alinha por índice', () => {
    expect(parseBatchGenres('["Rock","Pop","Trap"]', 3)).toEqual(['Rock', 'Pop', 'Trap']);
  });

  it('normaliza a caixa para o rótulo da taxonomia', () => {
    expect(parseBatchGenres('["rock","HIP-HOP/RAP"]', 2)).toEqual(['Rock', 'Hip-Hop/Rap']);
  });

  it('rejeita gênero fora da taxonomia em vez de inventar', () => {
    expect(parseBatchGenres('["Rock","Vaporwave"]', 2)).toEqual(['Rock', null]);
  });

  it('DESCARTA o lote inteiro quando o tamanho não bate', () => {
    // O modelo devolveu 2 rótulos para 3 faixas: o alinhamento por índice
    // deixou de valer e daria o gênero da faixa 2 para a faixa 3.
    expect(parseBatchGenres('["Rock","Pop"]', 3)).toEqual([null, null, null]);
  });

  it('sobrevive a raciocínio antes do JSON', () => {
    const comRuido = 'Vou analisar cada uma...\nA primeira é rock.\n["Rock","Pop"]';
    expect(parseBatchGenres(comRuido, 2)).toEqual(['Rock', 'Pop']);
  });
});

describe('parseDescription', () => {
  it('pega a conclusão, não o rascunho do raciocínio', () => {
    const comRaciocinio =
      'Preciso citar artistas e ficar em 90 caracteres.\nTalvez algo sobre saudade.\nO sertanejo que embala a estrada, com Marília e Henrique & Juliano.';
    expect(parseDescription(comRaciocinio)).toBe(
      'O sertanejo que embala a estrada, com Marília e Henrique & Juliano.',
    );
  });

  it('tira aspas da frase', () => {
    expect(parseDescription('"Seu rock de todo dia"')).toBe('Seu rock de todo dia');
  });

  it('recusa resposta longa demais para um cartão', () => {
    expect(parseDescription('x'.repeat(250))).toBeNull();
  });
});

describe('translateMessages', () => {
  it('põe a instrução no user — em system o Riva devolve o original', () => {
    const msgs = translateMessages('Hello world', 'pt');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toBe('Translate to Portuguese: Hello world');
  });

  it('nunca emite mensagem de system', () => {
    expect(translateMessages('oi', 'en').some((m) => m.role === 'system')).toBe(false);
  });
});

describe('parseTranslation', () => {
  it('limpa cerca de markdown', () => {
    expect(parseTranslation('```\nÉ esta a vida real?\n```')).toBe('É esta a vida real?');
  });
  it('devolve null para resposta vazia', () => {
    expect(parseTranslation('   ')).toBeNull();
  });
});

describe('trackEmbeddingText', () => {
  it('põe título e artista na frente', () => {
    const texto = trackEmbeddingText({
      title: 'Imagina esse Cenário',
      artists: ['Veigh', 'Matuê'],
      album: 'Dos Prédio',
      genre: 'Trap',
    });
    expect(texto).toBe('Imagina esse Cenário — Veigh, Matuê — Dos Prédio — Trap');
  });

  it('omite os campos ausentes sem deixar separador solto', () => {
    expect(trackEmbeddingText({ title: 'Sozinho', artists: ['Caetano Veloso'] })).toBe(
      'Sozinho — Caetano Veloso',
    );
  });
});

describe('cosineSimilarity', () => {
  it('vale 1 para vetores idênticos', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });
  it('vale 0 para ortogonais', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('devolve 0 para tamanhos diferentes em vez de comparar lixo', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
  it('devolve 0 para vetor nulo sem dividir por zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('política de modelos', () => {
  it('veredito vai no barato, identidade vai no grande', () => {
    expect(modelFor('verify')).toBe(CHAT_MODELS.nano);
    expect(modelFor('identity')).toBe(CHAT_MODELS.super);
  });

  it('o ultra é escalação da identidade, não o padrão dela', () => {
    expect(modelFor('identity')).not.toBe(CHAT_MODELS.ultra);
    expect(escalationFor('identity')).toBe(CHAT_MODELS.ultra);
  });

  it('não há degrau acima do ultra', () => {
    expect(escalationFor('describe')).not.toBe(CHAT_MODELS.ultra);
  });

  it('o nano-9b-v2 está fora — deu falso-positivo em atribuição correta', () => {
    const usados = Object.values(CHAT_MODELS) as string[];
    expect(usados).not.toContain('nvidia/nvidia-nemotron-nano-9b-v2');
  });
});
