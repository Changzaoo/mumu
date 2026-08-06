/**
 * CATEGORIA ERRADA É PIOR QUE CATEGORIA NENHUMA.
 *
 * O classificador de gênero tinha dois defeitos que se somavam:
 *
 *  1. O prompt não dava saída. Mandava escolher UM gênero da lista, ponto — o
 *     modelo era obrigado a chutar diante de qualquer faixa que não conhecesse,
 *     que é o caso da maior parte do acervo (artista independente).
 *  2. O parser garimpava qualquer nome da taxonomia em QUALQUER lugar do texto.
 *     Com um modelo de raciocínio, que escreve o pensamento antes de concluir,
 *     isso lia o rascunho como decisão — e transformava uma RECUSA do modelo
 *     ("não conheço, talvez seja pop") numa categoria.
 *
 * O palpite não ficava escondido: virava a prateleira de gênero, o mix e a
 * recomendação. Estes testes travam a regra nova — na dúvida, `null`.
 */
import { describe, expect, it } from 'vitest';
import { GENRE_TAXONOMY, genreMessages, parseGenre } from '../ai/curation';

describe('classificação de gênero', () => {
  it('o prompt oferece DESCONHECIDO e proíbe deduzir pelo título', () => {
    const sistema = genreMessages('WARZONE', 'Brandão85')[0]?.content ?? '';
    expect(sistema).toContain('DESCONHECIDO');
    expect(sistema).toContain('clima do título');
  });

  it('resposta limpa vira gênero', () => {
    expect(parseGenre('Trap')).toBe('Trap');
    expect(parseGenre('  MPB  ')).toBe('MPB');
  });

  it('aceita a conclusão depois do raciocínio — é a ÚLTIMA linha que vale', () => {
    expect(parseGenre('A faixa tem base de 808 e flow cantado.\nTrap')).toBe('Trap');
    expect(parseGenre('Gênero: Rock')).toBe('Rock');
    expect(parseGenre('**Pagode**')).toBe('Pagode');
  });

  // ── O DEFEITO ────────────────────────────────────────────────────────────
  it('recusa do modelo NÃO vira categoria', () => {
    expect(parseGenre('Não conheço essa música, talvez seja Pop')).toBeNull();
    expect(parseGenre('DESCONHECIDO')).toBeNull();
    expect(parseGenre('Desconhecido')).toBeNull();
  });

  it('negação no meio do raciocínio não é atribuição', () => {
    // Antes: achava "Rock" na frase e creditava Rock à faixa.
    expect(parseGenre('Isso definitivamente não é Rock.')).toBeNull();
  });

  it('texto sem conclusão vira null, e a faixa fica sem categoria', () => {
    expect(parseGenre('Preciso de mais contexto para responder.')).toBeNull();
    expect(parseGenre('')).toBeNull();
  });

  it('inventar categoria fora da taxonomia não passa', () => {
    expect(parseGenre('Brega Funk')).toBeNull();
  });

  // ── tolerância que não afrouxa a regra ──────────────────────────────────
  it('pontuação e acento do rótulo não derrubam uma resposta boa', () => {
    expect(parseGenre('Hip Hop/Rap')).toBe('Hip-Hop/Rap');
    expect(parseGenre('eletronica')).toBe('Eletrônica');
    expect(parseGenre('"R&B/Soul".')).toBe('R&B/Soul');
  });

  it('todo rótulo da taxonomia é reconhecido por ele mesmo', () => {
    for (const g of GENRE_TAXONOMY) expect(parseGenre(g)).toBe(g);
  });
});
