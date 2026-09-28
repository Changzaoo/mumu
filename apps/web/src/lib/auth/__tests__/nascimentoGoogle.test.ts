import { describe, expect, it } from 'vitest';
import { anoMesDaResposta } from '../nascimentoGoogle';

describe('nascimento da conta Google', () => {
  it('usa mês e ano da conta e descarta o dia', () => {
    expect(
      anoMesDaResposta({
        birthdays: [
          { date: { year: 1990, month: 1, day: 2 }, metadata: { source: { type: 'CONTACT' } } },
          { date: { year: 2008, month: 7, day: 15 }, metadata: { source: { type: 'ACCOUNT' } } },
        ],
      }),
    ).toBe('2008-07');
  });

  it('sem ano (aniversário sem ano) não serve', () => {
    expect(anoMesDaResposta({ birthdays: [{ date: { month: 3, day: 4 } }] })).toBeNull();
    expect(anoMesDaResposta({})).toBeNull();
  });

  it('data absurda é ignorada', () => {
    expect(anoMesDaResposta({ birthdays: [{ date: { year: 1800, month: 3 } }] })).toBeNull();
    expect(anoMesDaResposta({ birthdays: [{ date: { year: 2000, month: 13 } }] })).toBeNull();
  });
});
