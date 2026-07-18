import { describe, expect, it } from 'vitest';
import { looksMusical } from '@/lib/artistBio';

describe('looksMusical', () => {
  it('aceita verbete de artista (pt e en)', () => {
    expect(looksMusical('Anitta é uma cantora e compositora brasileira.')).toBe(true);
    expect(looksMusical('Queen foi uma banda britânica de rock.')).toBe(true);
    expect(looksMusical('Queen were a British rock band formed in 1970.')).toBe(true);
    expect(looksMusical('Racionais MC’s é um grupo musical de rap de São Paulo.')).toBe(true);
  });

  it('usa a descrição quando o resumo não diz nada', () => {
    expect(looksMusical('Formado em 1991 em Belo Horizonte.', 'banda brasileira')).toBe(true);
  });

  it('rejeita homônimo — "populosa" não faz de uma cidade uma banda', () => {
    expect(looksMusical('Fresno é a quinta cidade mais populosa do estado da Califórnia.')).toBe(
      false,
    );
    expect(looksMusical('Foi erguida uma bandeira no alto do morro.')).toBe(false);
    expect(looksMusical('O trem chegou rapidamente à estação.')).toBe(false);
  });

  it('rejeita texto vazio', () => {
    expect(looksMusical(null, undefined, '')).toBe(false);
  });
});
