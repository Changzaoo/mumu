import { describe, expect, it } from 'vitest';
import { creditoAmbiguo, separarArtistasDaFaixa, separarCreditos } from '../creditosDeArtista.js';

describe('separarCreditos', () => {
  it('a vírgula separa: o caso "Tz da Coronel, Matuê" vira dois artistas', () => {
    expect(separarCreditos('Tz da Coronel, Matuê')).toEqual(['Tz da Coronel', 'Matuê']);
    expect(separarCreditos('Justin Bieber, SZA')).toEqual(['Justin Bieber', 'SZA']);
    expect(separarCreditos('LEALL, Rock Danger, Babidi')).toEqual([
      'LEALL',
      'Rock Danger',
      'Babidi',
    ]);
  });

  it('"&", "+", ";", " x " e " vs " separam', () => {
    expect(separarCreditos('Anuel AA & Ozuna')).toEqual(['Anuel AA', 'Ozuna']);
    expect(separarCreditos('Brandão85, Jovem Dex, Leviano & Alee')).toEqual([
      'Brandão85',
      'Jovem Dex',
      'Leviano',
      'Alee',
    ]);
    expect(separarCreditos('Alok x Sevenn')).toEqual(['Alok', 'Sevenn']);
    expect(separarCreditos('Alok vs. Sevenn')).toEqual(['Alok', 'Sevenn']);
    expect(separarCreditos('MC PP da VS')).toEqual(['MC PP da VS']);
  });

  it('participação sempre separa, com ou sem ponto, com ou sem parêntese', () => {
    expect(separarCreditos('Djonga feat. Rincon Sapiência')).toEqual([
      'Djonga',
      'Rincon Sapiência',
    ]);
    expect(separarCreditos('WIU ft Matuê')).toEqual(['WIU', 'Matuê']);
    expect(separarCreditos('Hungria (part. Lucas Lucco)')).toEqual(['Hungria', 'Lucas Lucco']);
    expect(separarCreditos('Anitta featuring Cardi B')).toEqual(['Anitta', 'Cardi B']);
  });

  it('grupos com separador no nome ficam inteiros', () => {
    for (const nome of [
      'AC/DC',
      'Earth, Wind & Fire',
      'Tyler, The Creator',
      'Macklemore & Ryan Lewis',
      'Kool & The Gang',
      'Chitãozinho e Xororó',
      'Henrique e Juliano',
      'Tonico e Tinoco',
      'Zé Mulato e Cassiano',
    ]) {
      expect(separarCreditos(nome)).toEqual([nome]);
    }
    // Mesmo dentro de uma lista maior.
    expect(separarCreditos('Earth, Wind & Fire feat. The Emotions')).toEqual([
      'Earth, Wind & Fire',
      'The Emotions',
    ]);
  });

  it('" e " só separa com prova: prefixo MC/DJ dos dois lados…', () => {
    expect(separarCreditos('MC Kevin e MC Ryan SP')).toEqual(['MC Kevin', 'MC Ryan SP']);
    expect(separarCreditos('MC Daniel e MC Poze do Rodo')).toEqual([
      'MC Daniel',
      'MC Poze do Rodo',
    ]);
    expect(separarCreditos('DJ Victor E Caio passos')).toEqual(['DJ Victor E Caio passos']);
  });

  it('…ou os dois lados já existirem sozinhos no acervo', () => {
    const acervo = new Set(['kawe', 'wiu', 'matue', 'tz da coronel', 'mc maneirinho']);
    const conhecido = (n: string) =>
      acervo.has(n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    expect(separarCreditos('Kawe e Wiu', { conhecido })).toEqual(['Kawe', 'Wiu']);
    expect(separarCreditos('MC Maneirinho e TZ Da Coronel', { conhecido })).toEqual([
      'MC Maneirinho',
      'TZ Da Coronel',
    ]);
    // Um lado desconhecido: pode ser dupla, fica junto.
    expect(separarCreditos('Kawe e Fulano', { conhecido })).toEqual(['Kawe e Fulano']);
    // Sem a função, só o prefixo prova.
    expect(separarCreditos('Kawe e Wiu')).toEqual(['Kawe e Wiu']);
  });

  it('a barra não separa (apelido, não dupla)', () => {
    expect(separarCreditos('Cat Stevens/Yusuf Islam')).toEqual(['Cat Stevens/Yusuf Islam']);
    expect(creditoAmbiguo('Cat Stevens/Yusuf Islam')).toBe(true);
    expect(creditoAmbiguo('AC/DC')).toBe(false);
    expect(creditoAmbiguo('Tz da Coronel, Matuê')).toBe(false);
  });

  it('selo na lista sai quando sobra alguém; nome repetido fica um só', () => {
    expect(separarCreditos('Atlantic Records, Cardi B')).toEqual(['Cardi B']);
    expect(separarCreditos('MC Luuky, Walk Records')).toEqual(['MC Luuky']);
    expect(separarCreditos('Justin Bieber, Skrillex, Justin Bieber')).toEqual([
      'Justin Bieber',
      'Skrillex',
    ]);
  });

  it('ponto final e parêntese de fecho são parte do nome', () => {
    for (const nome of [
      'Charlie Brown Jr.',
      'R.E.M.',
      'Boney M.',
      'Fun.',
      'Mc Gw (DJ Patrick Original)',
    ]) {
      expect(separarCreditos(nome)).toEqual([nome]);
    }
    expect(separarCreditos('Boladin 211, . Mc Rick')).toEqual(['Boladin 211', 'Mc Rick']);
  });

  it('remonta um grupo partido no meio de uma lista', () => {
    const conhecido = () => true;
    expect(separarCreditos('Jerry Smith e MC Loma e As Gêmeas Lacração', { conhecido })).toEqual([
      'Jerry Smith',
      'MC Loma e As Gêmeas Lacração',
    ]);
    expect(separarCreditos('Prince and the Revolution', { conhecido })).toEqual([
      'Prince and the Revolution',
    ]);
    expect(separarCreditos('Pena Branca and Xavantinho', { conhecido })).toEqual([
      'Pena Branca and Xavantinho',
    ]);
    expect(separarCreditos('Ryu, the Runner')).toEqual(['Ryu, the Runner']);
  });

  it('o que está entre parênteses não é lista de artistas', () => {
    expect(separarCreditos('Olly Alexander (Years & Years)')).toEqual([
      'Olly Alexander (Years & Years)',
    ]);
    expect(
      separarCreditos('Mc Gw (Dj Kennedy OBraboo e Dj Guina)', { conhecido: () => true }),
    ).toEqual(['Mc Gw (Dj Kennedy OBraboo e Dj Guina)']);
    expect(separarCreditos('Dan + Shay, Justin Bieber')).toEqual(['Dan + Shay', 'Justin Bieber']);
  });

  it('nunca devolve vazio para texto não vazio', () => {
    expect(separarCreditos('')).toEqual([]);
    expect(separarCreditos('   ')).toEqual([]);
    expect(separarCreditos(', ,')).toEqual([', ,']);
  });
});

describe('separarArtistasDaFaixa', () => {
  it('devolve o MESMO array quando nada muda', () => {
    const artistas = [{ id: 'a', name: 'Matuê', slug: 'matue' }];
    expect(separarArtistasDaFaixa(artistas)).toBe(artistas);
  });

  it('desfaz o crédito junto: o primeiro herda o objeto, os outros nascem só com o nome', () => {
    const artistas = [{ id: 'local-artist:x:0', name: 'Tz da Coronel, Matuê', slug: '' }];
    expect(separarArtistasDaFaixa(artistas)).toEqual([
      { id: 'local-artist:x:0', name: 'Tz da Coronel', slug: '' },
      { id: 'local-artist:x:0:1', name: 'Matuê', slug: '' },
    ]);
  });

  it('não duplica quem já estava creditado à parte', () => {
    const artistas = [
      { id: '1', name: 'WIU & Matuê' },
      { id: '2', name: 'Matuê' },
    ];
    expect(separarArtistasDaFaixa(artistas)).toEqual([
      { id: '1', name: 'WIU' },
      { id: '1:1', name: 'Matuê' },
    ]);
  });
});
