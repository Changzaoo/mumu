/**
 * Links colados terminados pelo servidor: as decisões puras.
 */
import { describe, expect, it, vi } from 'vitest';
import { idDaImportacao } from '@radinho/shared';

vi.mock('../config/index.js', () => ({ env: {} }));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack: vi.fn() }));

const { ehPlaylist, nomeDaFaixa } = await import('./importacoes.worker.js');

describe('playlist ou música', () => {
  it('lista inteira é playlist; vídeo dentro de lista é música (a não ser que peçam)', () => {
    expect(ehPlaylist('https://www.youtube.com/playlist?list=PL123')).toBe(true);
    expect(ehPlaylist('https://www.youtube.com/watch?v=abcdefghijk&list=PL123')).toBe(false);
    expect(ehPlaylist('https://www.youtube.com/watch?v=abcdefghijk&list=PL123', true)).toBe(true);
    expect(ehPlaylist('https://www.youtube.com/watch?v=abcdefghijk')).toBe(false);
    expect(ehPlaylist('https://soundcloud.com/fulano/sets/album-x')).toBe(true);
  });
});

describe('nome da faixa baixada', () => {
  it('limpa o título do vídeo pelo artista', () => {
    expect(nomeDaFaixa({ title: 'Matuê - Mantém (Clipe Oficial)', uploader: 'Matuê' })).toEqual({
      title: 'Mantém',
      artists: ['Matuê'],
    });
  });
  it('canal "- Topic" vira o artista', () => {
    expect(nomeDaFaixa({ title: 'Mantém', uploader: 'Matuê - Topic' }).artists).toEqual(['Matuê']);
  });
});

describe('o mesmo link, o mesmo registro', () => {
  it('id estável, ignorando espaços; links diferentes, ids diferentes', () => {
    const a = idDaImportacao('https://www.youtube.com/watch?v=abcdefghijk');
    expect(idDaImportacao('  https://www.youtube.com/watch?v=abcdefghijk ')).toBe(a);
    expect(idDaImportacao('https://www.youtube.com/watch?v=abcdefghijl')).not.toBe(a);
    expect(a).toMatch(/^imp-[0-9a-f]{16}$/);
  });
});
