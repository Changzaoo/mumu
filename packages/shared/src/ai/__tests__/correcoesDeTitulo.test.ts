/**
 * A tabela conferida à mão: casa pelo título gravado, respeita a guarda e não
 * manda regravar o que já está certo.
 */
import { describe, expect, it } from 'vitest';
import { corrigirTituloConhecido, TOTAL_DE_CORRECOES_DE_TITULO } from '../correcoesDeTitulo.js';

describe('corrigirTituloConhecido', () => {
  it('devolve a música e quem canta quando os campos estavam trocados', () => {
    expect(corrigirTituloConhecido('HQ', ['Jimi Hendrix', 'Little wing'])).toEqual({
      title: 'Little Wing',
      artists: ['Jimi Hendrix'],
    });
    expect(
      corrigirTituloConhecido('Official Video (HQ)', ['Vanessa Carlton, A Thousand Miles']),
    ).toEqual({ title: 'A Thousand Miles', artists: ['Vanessa Carlton'] });
  });

  it('troca "Desconhecido" e canal por quem canta', () => {
    expect(corrigirTituloConhecido('AQUARELA TOQUINHO', ['Desconhecido'])).toEqual({
      title: 'Aquarela',
      artists: ['Toquinho'],
    });
    expect(
      corrigirTituloConhecido('Laura Branigan Self control - Legendado', ['Só FlashBack']),
    ).toEqual({ title: 'Self Control', artists: ['Laura Branigan'] });
  });

  it('título genérico só casa com a guarda do artista', () => {
    expect(corrigirTituloConhecido('Stay', ['Rihanna', 'Mikky Ekko'])).toBeNull();
    expect(corrigirTituloConhecido('Stay', ['London Records', 'Shakespears Sister'])).toEqual({
      title: 'Stay',
      artists: ['Shakespears Sister'],
    });
    expect(corrigirTituloConhecido('HQ', ['Fulano'])).toBeNull();
  });

  it('compara sem caixa, acento nem enfeite de fonte', () => {
    expect(corrigirTituloConhecido('𝕻𝖗𝖔𝖈𝖔𝖑 𝕳𝖆𝖗𝖚𝖒', ['𝕬 𝖂𝖍𝖎𝖙𝖊𝖗 𝕾𝖍𝖆𝖉𝖊 𝕺𝖋 𝕻𝖆𝖑𝖊'])).toEqual({
      title: 'A Whiter Shade of Pale',
      artists: ['Procol Harum'],
    });
    expect(corrigirTituloConhecido('aquarela toquinho', ['desconhecido'])?.title).toBe('Aquarela');
  });

  it('não manda regravar o que já está como a tabela quer', () => {
    expect(corrigirTituloConhecido('Stay', ['Shakespears Sister'])).toBeNull();
    expect(
      corrigirTituloConhecido('Big Yellow Taxi', ['Counting Crows', 'Vanessa Carlton']),
    ).toBeNull();
    expect(corrigirTituloConhecido('Video Games', ['Lana Del Rey'])).toBeNull();
  });

  it('a tabela não está vazia', () => {
    expect(TOTAL_DE_CORRECOES_DE_TITULO).toBeGreaterThan(150);
  });
});

describe('prévia de 14/11/2026', () => {
  it('devolve o "VS" cortado de MC PP da VS e sossega depois', () => {
    expect(corrigirTituloConhecido('Atividade', ['Mc PP da', 'MC Ryan SP'])?.artists).toEqual([
      'MC PP da VS',
      'MC Ryan SP',
    ]);
    expect(corrigirTituloConhecido('Atividade', ['MC PP da VS', 'MC Ryan SP'])).toBeNull();
    expect(corrigirTituloConhecido('Tamo Ai Na Atividade', ['Charlie Brown Jr.'])).toBeNull();
    expect(corrigirTituloConhecido('Atividade', ['Outro Artista'])).toBeNull();
  });

  it('destroca a lista de MCs e a música', () => {
    const c = corrigirTituloConhecido('MC Kevin, MC IG, MC PH', ['Deus', 'por favor', 'Dj WN']);
    expect(c).toEqual({
      title: 'Deus, Por Favor',
      artists: ['MC Kevin', 'MC IG', 'MC PH', 'DJ WN'],
    });
  });
});
