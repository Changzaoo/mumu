/**
 * O LINK DE PLAYLIST DO CELULAR NÃO PODE VIRAR UMA FAIXA SÓ, EM SILÊNCIO.
 *
 * "Compartilhar" dentro de uma playlist no app do YouTube gera
 * `m.youtube.com/watch?v=X&list=Y` — o MESMO endereço para "esta música" e para
 * "esta playlist". O app resolvia a ambiguidade sozinho, sempre pela música, e
 * as outras faixas sumiam sem aviso nenhum. Medido em produção: zero chamadas ao
 * `/playlist` do importer em toda a vida do log, contra sete imports avulsos —
 * e um desses links enumerava 528 faixas.
 *
 * `listaEmbutida` não adivinha a intenção: ela só detecta que existe uma escolha
 * a fazer, para o diálogo poder perguntar.
 */
import { describe, expect, it } from 'vitest';
import { ehRadioAutomatica, isPlaylistUrl, listaEmbutida } from '@/lib/local/importerHelper';

describe('listaEmbutida — a lista que vem de carona no link do vídeo', () => {
  it('acha a lista no link que o YouTube do celular compartilha', () => {
    // O caso real, tirado do log do importer.
    expect(
      listaEmbutida('https://m.youtube.com/watch?v=EfJMGfM3c5Q&list=RDEfJMGfM3c5Q&start_radio=1'),
    ).toBe('RDEfJMGfM3c5Q');
  });

  it('acha a lista numa playlist de verdade', () => {
    expect(listaEmbutida('https://www.youtube.com/watch?v=abc123&list=PLxyz789')).toBe('PLxyz789');
  });

  it('devolve null quando não há escolha a fazer', () => {
    // Vídeo sozinho: nada a perguntar.
    expect(listaEmbutida('https://www.youtube.com/watch?v=abc123')).toBeNull();
    // Lista pura: `isPlaylistUrl` já resolve, sem ambiguidade.
    expect(listaEmbutida('https://www.youtube.com/playlist?list=PLxyz789')).toBeNull();
    // Fora do YouTube.
    expect(listaEmbutida('https://soundcloud.com/artista/sets/album')).toBeNull();
    expect(listaEmbutida('não é link')).toBeNull();
  });

  it('a lista pura continua sendo playlist, e o vídeo com lista continua NÃO sendo', () => {
    // O padrão seguro não mudou: o botão principal segue o que o link aponta.
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PLxyz')).toBe(true);
    expect(isPlaylistUrl('https://m.youtube.com/watch?v=X&list=RDX&start_radio=1')).toBe(false);
  });
});

describe('ehRadioAutomatica — mix do YouTube não é playlist de ninguém', () => {
  it('reconhece o mix/rádio pelo prefixo RD', () => {
    // Este id enumerou 528 faixas num teste real — importar em massa encheria
    // o cofre com "parecidas" que ninguém escolheu.
    expect(ehRadioAutomatica('RDEfJMGfM3c5Q')).toBe(true);
    expect(ehRadioAutomatica('RDMM')).toBe(true);
  });

  it('não confunde playlist de verdade com rádio', () => {
    expect(ehRadioAutomatica('PLxyz789')).toBe(false);
    expect(ehRadioAutomatica('OLAK5uy_abc')).toBe(false);
    expect(ehRadioAutomatica('UUabc')).toBe(false);
  });
});
