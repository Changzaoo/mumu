/** O link do YouTube que o servidor escolhe para a faixa de fora do acervo. */
import { describe, expect, it } from 'vitest';
import { ehLinkDoYoutube, escolherVideoDaFaixa } from './emAlta.js';

const v = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
const faixa = { titulo: 'Anos Luz', artista: 'Matuê', duracaoMs: 200_000 };

describe('escolherVideoDaFaixa', () => {
  it('pega o primeiro vídeo com título, artista e duração que batem', () => {
    const url = escolherVideoDaFaixa(
      [
        { url: v('aaaaaaaaaaa'), titulo: 'Matuê - Anos Luz (Speed Up)', duracaoSeg: 180 },
        { url: v('bbbbbbbbbbb'), titulo: 'Anos Luz', canal: 'Outro Cantor', duracaoSeg: 200 },
        { url: v('ccccccccccc'), titulo: 'Matuê - Anos Luz AO VIVO', duracaoSeg: 420 },
        {
          url: v('ddddddddddd'),
          titulo: 'Anos Luz (Clipe Oficial)',
          canal: 'Matuê',
          duracaoSeg: 205,
        },
      ],
      faixa,
    );
    expect(url).toBe(v('ddddddddddd'));
  });

  it('na dúvida devolve null', () => {
    expect(escolherVideoDaFaixa([], faixa)).toBeNull();
    expect(
      escolherVideoDaFaixa([{ url: 'https://exemplo.com/x', titulo: 'Matuê - Anos Luz' }], faixa),
    ).toBeNull();
    expect(
      escolherVideoDaFaixa(
        [{ url: v('eeeeeeeeeee'), titulo: 'Matuê - Luz', duracaoSeg: 200 }],
        faixa,
      ),
    ).toBeNull();
  });

  it('reconhece o link de vídeo do YouTube', () => {
    expect(ehLinkDoYoutube(v('abcdefghijk'))).toBe(true);
    expect(ehLinkDoYoutube('https://www.deezer.com/track/1')).toBe(false);
    expect(ehLinkDoYoutube(null)).toBe(false);
  });
});
