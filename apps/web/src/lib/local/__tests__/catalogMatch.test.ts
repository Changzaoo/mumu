/**
 * Casamento de faixa órfã contra o catálogo do artista.
 *
 * Os dados aqui NÃO são inventados: títulos, artistas e durações saíram de
 * consultas reais à Deezer com as faixas que o usuário reportou como quebradas.
 * Por isso os casos negativos importam tanto quanto os positivos — esta função
 * grava autoria na biblioteca, e uma atribuição errada é pior que "Desconhecido":
 * ela mente com confiança e o usuário não tem como perceber.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import {
  candidateArtists,
  indexCatalog,
  matchInCatalog,
  type CatalogTrack,
} from '@/lib/local/catalogMatch';

function t(title: string, artist: string | null, durationMs: number): TrackDto {
  return {
    id: `local:${title}:${artist ?? 'x'}`,
    title,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: artist ? [{ id: 'a', name: artist, slug: '', imageUrl: null }] : [],
    streamUrl: null,
    uploadedByUserId: null,
  } as TrackDto;
}

function c(title: string, artist: string, duration: number, album = 'ALBUM'): CatalogTrack {
  return { title, artist, album, duration, cover: `https://cdn/${title}.jpg` };
}

// Recorte fiel do catálogo Deezer dos três artistas do acervo do usuário.
const CATALOGO = indexCatalog([
  c('CEO', 'Brandão85', 133, 'CEO'),
  c('SONHOS', 'Brandão85', 233),
  c('TUDO BEM', 'Brandão85', 143),
  c('BENÇA', 'Brandão85', 144, 'ISSO É TRAP VOL.2'),
  c('CAROLINA', 'Alee', 121, 'CAOS'),
  c('ATRIZ', 'Alee', 123, 'CAOS DLX'),
  c('ESTRESSE', 'Alee', 164),
  c('SÃO PAULO', 'Alee', 161),
  c('BACKSTAGE', 'Matuê', 139, 'XTRANHO'),
  c('AUTOBAHN', 'Matuê', 185, 'XTRANHO'),
]);

describe('matchInCatalog', () => {
  it('identifica faixa anônima por título + duração', () => {
    // "CEO / Desconhecido / 2:13" — buscar "CEO" solto na Deezer devolve o SCH.
    const hit = matchInCatalog(t('CEO', null, 133_000), CATALOGO);
    expect(hit?.artist).toBe('Brandão85');
    expect(hit?.cover).toBeTruthy();
  });

  it('resolve o caso que a busca por título errava (CAROLINA → Ninho)', () => {
    expect(matchInCatalog(t('CAROLINA', null, 121_000), CATALOGO)?.artist).toBe('Alee');
  });

  it('ignora participação grudada no título', () => {
    // Acervo: "TUDO BEM FT. BNYX". Catálogo: "TUDO BEM".
    expect(matchInCatalog(t('TUDO BEM FT. BNYX', null, 143_000), CATALOGO)?.artist).toBe(
      'Brandão85',
    );
  });

  it('ignora número de faixa e produtor', () => {
    const bruto = '22 - SÃO PAULO feat. Klisman (prod. QualyWav1, DougBeats)';
    expect(matchInCatalog(t(bruto, null, 161_000), CATALOGO)?.artist).toBe('Alee');
  });

  it('casa apesar de caixa e acento', () => {
    expect(matchInCatalog(t('bença', null, 144_000), CATALOGO)?.artist).toBe('Brandão85');
  });

  it('aceita desvio pequeno de duração (corte do encoder)', () => {
    expect(matchInCatalog(t('SONHOS', null, 235_500), CATALOGO)?.title).toBe('SONHOS');
  });

  it('RECUSA quando a duração destoa — outra versão, outra música', () => {
    // "ESTRESSE" existe, mas 4:10 não é a faixa de 2:44.
    expect(matchInCatalog(t('ESTRESSE', null, 250_000), CATALOGO)).toBeNull();
  });

  it('RECUSA título que não está no catálogo', () => {
    expect(matchInCatalog(t('PIRÂMIDE', null, 158_000), CATALOGO)).toBeNull();
  });

  it('RECUSA faixa sem duração — não há como conferir identidade', () => {
    expect(matchInCatalog(t('CEO', null, 0), CATALOGO)).toBeNull();
  });

  it('RECUSA empate entre artistas diferentes', () => {
    // Mesmo título, mesma duração, donos distintos: escolher seria chutar.
    const ambiguo = indexCatalog([c('SEGREDO', 'Alee', 151), c('SEGREDO', 'Matuê', 151)]);
    expect(matchInCatalog(t('SEGREDO', null, 151_000), ambiguo)).toBeNull();
  });

  it('desempata pela duração quando um dos lados é claramente melhor', () => {
    const dois = indexCatalog([c('SEGREDO', 'Alee', 151), c('SEGREDO', 'Matuê', 154)]);
    expect(matchInCatalog(t('SEGREDO', null, 151_000), dois)?.artist).toBe('Alee');
  });

  it('empate entre faixas do MESMO artista é aceitável (versões do mesmo dono)', () => {
    const mesmo = indexCatalog([
      c('RAGE', 'Brandão85', 129, 'SINGLE'),
      c('RAGE', 'Brandão85', 129, 'ALBUM'),
    ]);
    expect(matchInCatalog(t('RAGE', null, 129_000), mesmo)?.artist).toBe('Brandão85');
  });
});

describe('candidateArtists', () => {
  it('tira os artistas da própria biblioteca, do mais frequente ao menos', () => {
    const lib = [
      t('SONHOS', 'BRANDÃO85', 1),
      t('RAGE', 'BRANDÃO85', 1),
      t('ÚLTIMA VEZ', 'ALEE', 1),
      t('CEO', null, 1),
    ];
    expect(candidateArtists(lib)).toEqual(['BRANDÃO85', 'ALEE']);
  });

  it('não propõe "Desconhecido" como artista para buscar', () => {
    expect(candidateArtists([t('X', 'Desconhecido', 1), t('Y', null, 1)])).toEqual([]);
  });

  it('junta grafias que só diferem em caixa/acento', () => {
    const lib = [t('A', 'Brandão85', 1), t('B', 'BRANDÃO85', 1), t('C', 'brandao85', 1)];
    expect(candidateArtists(lib)).toHaveLength(1);
  });
});
