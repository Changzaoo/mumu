import { describe, expect, it } from 'vitest';
import { textoDeCarga, type EstadoDeCarga } from '@/lib/audio/estadoDeCarga';

const em = (fase: EstadoDeCarga['fase'], extra: Partial<EstadoDeCarga> = {}): EstadoDeCarga => ({
  fase,
  desde: 0,
  ...extra,
});

describe('textoDeCarga', () => {
  it('carga rápida não fala nada — "Carregando…" piscando é ruído', () => {
    expect(textoDeCarga(em('carregando'), 800)).toBeNull();
    expect(textoDeCarga(em('preparando'), 1_000)).toBeNull();
  });

  it('passou do instante, diz o que está fazendo', () => {
    expect(textoDeCarga(em('carregando'), 2_000)).toMatch(/carregando/i);
    expect(textoDeCarga(em('buscandoOrigem'), 2_000)).toMatch(/fonte original/i);
  });

  it('demorando, o texto muda e explica a espera', () => {
    expect(textoDeCarga(em('carregando'), 9_000)).toMatch(/conexão pode estar lenta/i);
    expect(textoDeCarga(em('buscandoOrigem'), 9_000)).toMatch(/primeira vez/i);
  });

  it('espera marcada aparece NA HORA, com a tentativa', () => {
    expect(textoDeCarga(em('reconstruindo', { tentativa: 1, total: 3 }), 0)).toBe(
      'O servidor está recuperando esta música (tentativa 1 de 3) — leva uns 20 segundos.',
    );
    expect(textoDeCarga(em('tentandoDeNovo', { tentativa: 2, total: 2 }), 0)).toMatch(
      /tentativa 2 de 2/,
    );
    expect(textoDeCarga(em('trocandoFonte'), 0)).toMatch(/outra fonte/i);
  });

  it('sem carga, nada', () => {
    expect(textoDeCarga(null, 50_000)).toBeNull();
  });
});
