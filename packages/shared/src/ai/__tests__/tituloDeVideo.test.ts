/**
 * TÍTULOS REAIS, copiados do banco de produção em 07/08/2026.
 *
 * Cada caso aqui é um estrago que aconteceu de verdade na prateleira. O mais
 * grave é o primeiro: o nome da música tinha ido para o campo do artista e a
 * lista de cantores para o campo do título — e como três sistemas decidem
 * olhando esses campos (gênero por artista, foto da ficha e detecção de
 * duplicata), um campo trocado estragava os três de uma vez.
 */
import { describe, expect, it } from 'vitest';
import { chaveDeIdentidade, lerTituloDeVideo } from '../tituloDeVideo.js';

describe('lerTituloDeVideo — o que é música e o que é gente', () => {
  it('as aspas mandam: o nome da faixa estava indo para o campo do artista', () => {
    const r = lerTituloDeVideo(
      'MC Ryan SP, Neguinho do Kaxeta, Vitinho Avassalador e MC PP da VS - "Liberdade" (DJ Boy)',
    );
    expect(r.title).toBe('Liberdade');
    expect(r.artists).toContain('MC Ryan SP');
    expect(r.artists).toContain('Neguinho do Kaxeta');
    // O que NÃO pode voltar a acontecer:
    expect(r.title).not.toContain('MC Ryan');
  });

  it('separador clássico "Artista - Música"', () => {
    const r = lerTituloDeVideo('Matuê - Anos Luz (Official Music Video)');
    expect(r.title).toBe('Anos Luz');
    expect(r.artists).toEqual(['Matuê']);
  });

  it('tira o ruído sem comer o nome da música', () => {
    expect(lerTituloDeVideo('U2 - Sunday Bloody Sunday (Live From Red Rocks)').title).toBe(
      'Sunday Bloody Sunday',
    );
    expect(lerTituloDeVideo('Gabriela Rocha - Lugar Secreto [CLIPE OFICIAL]').title).toBe(
      'Lugar Secreto',
    );
    expect(lerTituloDeVideo('Jó - COM LETRA (VideoLETRA® oficial)').title).toBe('Jó');
  });

  it('número de faixa e resolução de vídeo somem', () => {
    const r = lerTituloDeVideo('05 SÁ RODRIX & GUARABYRA - POT POURRI HD 640x360');
    expect(r.title).toBe('POT POURRI');
    expect(r.artists).toEqual(['SÁ RODRIX', 'GUARABYRA']);
  });

  it('CANAL DE GRAVADORA não vira artista', () => {
    // O caso "Raridade": o canal é MK MUSIC e o cantor é o Anderson Freire.
    const r = lerTituloDeVideo('Anderson Freire - Raridade', 'MK MUSIC');
    expect(r.artists).toEqual(['Anderson Freire']);
    expect(r.label).toBe('MK MUSIC');
    expect(r.artists).not.toContain('MK MUSIC');
  });

  it('canal comum VIRA artista quando não há mais nada', () => {
    const r = lerTituloDeVideo('Lugar Secreto', 'Gabriela Rocha');
    expect(r.title).toBe('Lugar Secreto');
    expect(r.artists).toEqual(['Gabriela Rocha']);
  });

  it('o selo no lado do artista não é gravado como quem canta', () => {
    const r = lerTituloDeVideo('MK MUSIC - Raridade');
    expect(r.title).toBe('Raridade');
    expect(r.artists).toEqual([]);
    expect(r.label).toBe('MK MUSIC');
  });

  it('lista longa de artistas quebra certo', () => {
    const r = lerTituloDeVideo('Alok, DJ Victor, MC Hariel e MC Davi - "ILUSÃO"');
    expect(r.title).toBe('ILUSÃO');
    expect(r.artists).toEqual(['Alok', 'DJ Victor', 'MC Hariel', 'MC Davi']);
  });

  it('não inventa nada num título simples', () => {
    const r = lerTituloDeVideo('Evidências');
    expect(r.title).toBe('Evidências');
    expect(r.artists).toEqual([]);
  });
});

describe('chaveDeIdentidade — é ela que faz duas cópias se reconhecerem', () => {
  it('a MESMA música com nomes de vídeo diferentes tem a mesma chave', () => {
    // A duplicata que passava batido: mesma faixa, dois canais, dois nomes.
    const a = chaveDeIdentidade('BENÇA (Official Music Video)', 'Matuê');
    const b = chaveDeIdentidade('BENÇA', 'Matuê');
    const c = chaveDeIdentidade('Bença [CLIPE OFICIAL]', 'MATUÊ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('músicas DIFERENTES não colidem', () => {
    expect(chaveDeIdentidade('Anos Luz', 'Matuê')).not.toBe(chaveDeIdentidade('BENÇA', 'Matuê'));
  });

  it('a mesma música de artistas diferentes não colide', () => {
    // Regravação e cover continuam sendo faixas distintas.
    expect(chaveDeIdentidade('Raridade', 'Anderson Freire')).not.toBe(
      chaveDeIdentidade('Raridade', 'Outro Cantor'),
    );
  });

  it('funciona sem artista, para o caso de a atribuição ainda estar vazia', () => {
    expect(chaveDeIdentidade('BENÇA (Official Video)')).toBe(chaveDeIdentidade('bença'));
  });
});
