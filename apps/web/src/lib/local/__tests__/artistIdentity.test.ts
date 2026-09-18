import { describe, expect, it } from 'vitest';
import { artistIdentityKey, melhorGrafia } from '@/lib/local/artistIdentity';

const mesma = (a: string, b: string): boolean => artistIdentityKey(a) === artistIdentityKey(b);

describe('artistIdentityKey', () => {
  it('une o papel anunciado ao nome ("DJ Kennedi" é "Kennedi")', () => {
    expect(mesma('DJ Kennedi', 'Kennedi')).toBe(true);
    expect(mesma('MC Brandão', 'Brandão')).toBe(true);
    expect(mesma('D.J. Kennedi', 'DJ Kennedi')).toBe(true);
  });

  it('une acento, pontuação e espaço', () => {
    expect(mesma('Brandão', 'Brandao')).toBe(true);
    expect(mesma('DJ Kennedi', 'djkennedi')).toBe(true);
    expect(mesma('Tim  Maia', 'Tim Maia')).toBe(true);
  });

  it('descarta o carimbo de canal', () => {
    expect(mesma('Tim Maia Oficial', 'Tim Maia')).toBe(true);
    expect(mesma('Tim Maia - Topic', 'Tim Maia')).toBe(true);
  });

  it('não junta pessoas diferentes', () => {
    expect(mesma('MC Kevin', 'MC Kelvin')).toBe(false);
    expect(mesma('Djavan', 'DJ Avan')).toBe(false);
    expect(mesma('Racionais MCs', 'Tim Maia')).toBe(false);
  });

  it('nome que sobra curto demais mantém a identidade inteira', () => {
    // "MC B" viraria "b" e engoliria qualquer artista chamado "B".
    expect(artistIdentityKey('MC B')).toBe('mcb');
    expect(mesma('MC B', 'B')).toBe(false);
  });

  it('nome só de papel continua valendo', () => {
    expect(artistIdentityKey('DJ')).toBe('dj');
  });
});

describe('melhorGrafia', () => {
  it('fica com a grafia de mais faixas', () => {
    expect(
      melhorGrafia({ name: 'Kennedi', trackCount: 2 }, { name: 'DJ Kennedi', trackCount: 9 }),
    ).toBe('DJ Kennedi');
  });

  it('no empate fica a mais completa', () => {
    expect(
      melhorGrafia({ name: 'Kennedi', trackCount: 3 }, { name: 'DJ Kennedi', trackCount: 3 }),
    ).toBe('DJ Kennedi');
  });

  it('maiúscula ganha de tudo-minúsculo', () => {
    expect(
      melhorGrafia({ name: 'tim maia', trackCount: 1 }, { name: 'Tim Maia', trackCount: 1 }),
    ).toBe('Tim Maia');
  });
});
