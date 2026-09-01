/**
 * A REGRA QUE, SE FALHAR, FAZ A PESSOA IR EMBORA.
 *
 * O rádio continua a fila sozinho depois que a música acaba. Quem pôs um louvor
 * para tocar e guardou o telefone não escolheu nada do que vem depois — então
 * o que vem depois é responsabilidade inteira do app.
 */
import { describe, expect, it } from 'vitest';
import { ehFamiliaSensivel, familiaDoGenero, podemConviver } from '../ai/familiasDeGenero.js';

describe('famílias de gênero', () => {
  it('agrupa vizinhos que ninguém estranha juntos', () => {
    expect(familiaDoGenero('Samba')).toBe(familiaDoGenero('Pagode'));
    expect(familiaDoGenero('Trap')).toBe(familiaDoGenero('Hip-Hop/Rap'));
    expect(familiaDoGenero('Rock')).toBe(familiaDoGenero('Metal'));
  });

  it('lê o rótulo com acento, sem acento e em qualquer caixa', () => {
    expect(familiaDoGenero('Eletrônica')).toBe('eletronica');
    expect(familiaDoGenero('eletronica')).toBe('eletronica');
    expect(familiaDoGenero('ELETRÔNICA')).toBe('eletronica');
  });

  it('gospel é família sensível; funk não é', () => {
    expect(ehFamiliaSensivel(familiaDoGenero('Gospel'))).toBe(true);
    expect(ehFamiliaSensivel(familiaDoGenero('Funk'))).toBe(false);
  });
});

describe('podemConviver — a fronteira', () => {
  const louvor = { genero: 'Gospel', conteudo: 'limpo' as const };

  it('FUNK NUNCA ENTRA NUM RÁDIO DE LOUVOR', () => {
    // O caso inteiro: alguém põe um louvor, sai da tela, e a fila continua.
    expect(podemConviver(louvor, { genero: 'Funk', conteudo: 'limpo' })).toBe(false);
    expect(podemConviver(louvor, { genero: 'Trap', conteudo: 'explicito' })).toBe(false);
  });

  it('num rádio de louvor, faixa SEM GÊNERO fica de fora', () => {
    // Em toda outra parte do app a dúvida resolve a favor de mostrar. Aqui,
    // contra: uma faixa sem categoria pode ser qualquer coisa.
    expect(podemConviver(louvor, { genero: null, conteudo: 'limpo' })).toBe(false);
  });

  it('num rádio de louvor, conteúdo DESCONHECIDO fica de fora', () => {
    // "Não sei se tem palavrão" não é "não tem palavrão".
    expect(podemConviver(louvor, { genero: 'Gospel', conteudo: null })).toBe(false);
    expect(podemConviver(louvor, { genero: 'Gospel' })).toBe(false);
  });

  it('gospel limpo entra em rádio de gospel', () => {
    expect(podemConviver(louvor, { genero: 'Gospel', conteudo: 'limpo' })).toBe(true);
  });

  it('fora das sensíveis, a fronteira é só a família', () => {
    const rock = { genero: 'Rock', conteudo: 'limpo' as const };
    expect(podemConviver(rock, { genero: 'Metal', conteudo: 'limpo' })).toBe(true);
    expect(podemConviver(rock, { genero: 'Sertanejo', conteudo: 'limpo' })).toBe(false);
  });

  it('fora das sensíveis, faixa sem gênero é aceita', () => {
    // Barrá-la esvaziaria o rádio de quase toda faixa importada pelo usuário,
    // que costuma chegar sem categoria.
    expect(podemConviver({ genero: 'Rock' }, { genero: null })).toBe(true);
  });

  it('semente sem gênero não tem fronteira a defender', () => {
    expect(podemConviver({ genero: null }, { genero: 'Funk' })).toBe(true);
  });
});
