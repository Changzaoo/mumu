import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

const acervo: TrackDto[] = [];
const internet: { url: string; titulo: string; canal: string; duracaoSeg: number; capa: null }[] =
  [];

vi.mock('@/lib/local/localLibrary', () => ({
  artistTracks: () => acervo,
  findBySource: () => null,
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buscarNoYoutube: async () => ({ ok: true, resultados: internet }),
  faixaDoYoutube: async (r: { url: string; titulo: string; canal: string }) => {
    const [artista, titulo] = r.titulo.split(' - ');
    return faixa(`youtube:${r.url.slice(-11)}`, titulo ?? r.titulo, artista ?? r.canal);
  },
}));

const { ehDoArtista, maisDoArtista } = await import('../filaDoArtista');

function faixa(id: string, title: string, artista: string): TrackDto {
  return {
    id,
    title,
    durationMs: 180_000,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [{ id: '', name: artista, slug: '', imageUrl: null }],
    streamUrl: null,
    downloadUrl: null,
    sourceUrl: null,
    uploadedByUserId: null,
  };
}

const video = (id: string, titulo: string, canal = 'qualquer') => ({
  url: `https://www.youtube.com/watch?v=${id.padEnd(11, 'x')}`,
  titulo,
  canal,
  duracaoSeg: 180,
  capa: null,
});

beforeEach(() => {
  acervo.length = 0;
  internet.length = 0;
});

describe('fila de quem tocou uma música da internet', () => {
  it('é do MESMO artista — não o resultado da busca', async () => {
    const tocada = faixa('youtube:aaaaaaaaaaa', 'Mantém', 'Matuê');
    internet.push(
      video('b', 'Matuê - Kenny G'),
      video('c', 'Outro Cara - Mantém'), // mesmo título, outro artista
      video('d', 'Matuê - Mantém'), // a própria música de novo
      video('e', 'Matuê - Quer Voar (slowed + reverb)'), // versão mexida
    );
    const fila = await maisDoArtista(tocada);
    expect(fila.map((t) => t.title)).toEqual(['Kenny G']);
  });

  it('acervo primeiro, internet depois, sem repetir a mesma música', async () => {
    acervo.push(faixa('local:1', 'Kenny G', 'Matuê'), faixa('local:2', 'É Sal', 'Matuê'));
    internet.push(video('b', 'Matuê - Kenny G'), video('c', 'Matuê - 777-666'));
    const fila = await maisDoArtista(faixa('youtube:aaaaaaaaaaa', 'Mantém', 'Matuê'));
    expect(fila.map((t) => t.id)).toEqual(['local:1', 'local:2', 'youtube:cxxxxxxxxxx']);
  });

  it('crédito com "feat." ainda conta como do artista', () => {
    expect(ehDoArtista(faixa('x', 't', 'Matuê feat Teto'), 'Matuê')).toBe(true);
    expect(ehDoArtista(faixa('x', 't', 'Matheus'), 'Matuê')).toBe(false);
  });

  it('sem artista, sem fila', async () => {
    const semNome = { ...faixa('x', 't', ''), artists: [] };
    expect(await maisDoArtista(semNome)).toEqual([]);
  });
});
