import { describe, expect, it } from 'vitest';
import { ligaAposVirada, semanaIso } from './jornada.regras.js';

describe('semanaIso (America/Sao_Paulo)', () => {
  it('segunda-feira abre a semana', () => {
    expect(semanaIso(new Date('2026-10-26T15:00:00Z'))).toBe('2026-W44');
    expect(semanaIso(new Date('2026-10-25T15:00:00Z'))).toBe('2026-W43'); // domingo
  });

  it('usa o fuso de São Paulo, não UTC', () => {
    // 02:00 UTC de segunda ainda é domingo à noite em São Paulo (UTC-3).
    expect(semanaIso(new Date('2026-10-26T02:00:00Z'))).toBe('2026-W43');
    expect(semanaIso(new Date('2026-10-26T03:00:00Z'))).toBe('2026-W44');
  });

  it('virada de ano ISO', () => {
    expect(semanaIso(new Date('2021-01-03T15:00:00Z'))).toBe('2020-W53');
    expect(semanaIso(new Date('2024-12-30T15:00:00Z'))).toBe('2025-W01');
    expect(semanaIso(new Date('2026-01-01T15:00:00Z'))).toBe('2026-W01');
  });
});

describe('ligaAposVirada', () => {
  it('sobe quem fez XP e ficou no top 10', () => {
    expect(ligaAposVirada({ liga: 0, xpAntigo: 50, posicao: 10, tamanho: 30 })).toEqual({
      liga: 1,
      mudou: 'subiu',
    });
  });
  it('não sobe com XP zero, nem fora do top 10', () => {
    expect(ligaAposVirada({ liga: 0, xpAntigo: 0, posicao: 1, tamanho: 3 })).toEqual({ liga: 0 });
    expect(ligaAposVirada({ liga: 0, xpAntigo: 5, posicao: 11, tamanho: 20 })).toEqual({ liga: 0 });
  });
  it('Diamante não passa do teto', () => {
    expect(ligaAposVirada({ liga: 5, xpAntigo: 90, posicao: 1, tamanho: 30 })).toEqual({ liga: 5 });
  });
  it('desce quem não fez XP', () => {
    expect(ligaAposVirada({ liga: 2, xpAntigo: 0, posicao: 4, tamanho: 5 })).toEqual({
      liga: 1,
      mudou: 'desceu',
    });
  });
  it('desce quem ficou entre os 5 últimos de grupo >= 10', () => {
    expect(ligaAposVirada({ liga: 3, xpAntigo: 10, posicao: 16, tamanho: 20 })).toEqual({
      liga: 2,
      mudou: 'desceu',
    });
    expect(ligaAposVirada({ liga: 3, xpAntigo: 10, posicao: 15, tamanho: 20 })).toEqual({
      liga: 3,
    });
    // grupo pequeno (< 10) não rebaixa por posição
    expect(ligaAposVirada({ liga: 3, xpAntigo: 10, posicao: 9, tamanho: 9 }).mudou).not.toBe(
      'desceu',
    );
  });
  it('Bronze não desce', () => {
    expect(ligaAposVirada({ liga: 0, xpAntigo: 0, posicao: 9, tamanho: 9 })).toEqual({ liga: 0 });
  });
  it('quem sobe não desce na mesma virada', () => {
    // posição 8 de 12: top 10 e também entre os 5 últimos.
    expect(ligaAposVirada({ liga: 2, xpAntigo: 7, posicao: 8, tamanho: 12 })).toEqual({
      liga: 3,
      mudou: 'subiu',
    });
  });
});
