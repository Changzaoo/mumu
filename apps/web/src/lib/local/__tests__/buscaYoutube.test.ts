/**
 * Busca no YouTube para a tela de busca — os dois lados da ponte.
 *
 *  - O CLIENTE (`importerHelper`): parse defensivo da resposta, os três
 *    estados de falha (login / limite / falha) e a faixa temporária
 *    `youtube:<id>` que o player toca direto pela `streamUrl`.
 *  - O IMPORTADOR (`apps/importer/buscaYoutube.mjs`): parse do JSON do
 *    `yt-dlp -J --flat-playlist`, os filtros do que não é música, o cache e o
 *    limite por usuário. Os tipos vêm de `buscaYoutube.d.mts`, ao lado dele.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idToken = vi.hoisted(() => ({ valor: 'tok-123' as string | null }));

vi.mock('@/lib/firebase', () => ({
  getIdToken: () => Promise.resolve(idToken.valor),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ audioQuality: 'high' }) },
}));

import {
  buscarNoYoutube,
  faixaDoYoutube,
  parseResultadosYoutube,
  videoIdDoYoutube,
} from '@/lib/local/importerHelper';

import * as moduloDoImportador from '../../../../../importer/buscaYoutube.mjs';

const carregarModulo = (): Promise<typeof moduloDoImportador> =>
  Promise.resolve(moduloDoImportador);

/** Recorte real (encurtado) da saída do yt-dlp para "racionais eu sou 157". */
const SAIDA_YTDLP = JSON.stringify({
  _type: 'playlist',
  id: 'racionais eu sou 157',
  entries: [
    {
      _type: 'url',
      ie_key: 'Youtube',
      id: 'fgysUhl98As',
      url: 'https://www.youtube.com/watch?v=fgysUhl98As',
      title: 'Eu sou 157 - Nada Como Um Dia Após O Outro Dia (Chora Agora)',
      channel: 'Racionais TV',
      duration: 532.0,
      live_status: null,
      thumbnails: [{ url: 'https://i.ytimg.com/vi/fgysUhl98As/hq720.jpg?sqp=assinada' }],
    },
    // Short: menos de 1 min, e pelo caminho /shorts/.
    {
      ie_key: 'Youtube',
      id: 'AAAAAAAAAAA',
      url: 'https://www.youtube.com/shorts/AAAAAAAAAAA',
      title: 'trecho',
      duration: 40,
    },
    // Live em curso: sem fim, o /stream não sabe servir.
    { ie_key: 'Youtube', id: 'BBBBBBBBBBB', title: 'AO VIVO 24h', live_status: 'is_live' },
    // Compilação de uma hora.
    { ie_key: 'Youtube', id: 'CCCCCCCCCCC', title: 'Racionais 1 hora', duration: 3600 },
    // Canal no meio dos resultados.
    { ie_key: 'YoutubeTab', id: 'UCxxxxxxxxxxxxxxxx', title: 'Racionais TV', duration: 200 },
    // Duplicata do primeiro (acontece na paginação da busca).
    { ie_key: 'Youtube', id: 'fgysUhl98As', title: 'Eu sou 157', duration: 532 },
    // Sem canal, só uploader, e id no lugar da url.
    {
      ie_key: 'Youtube',
      id: 'CsglWlcZTio',
      url: 'CsglWlcZTio',
      title: '  Eu sou 157 - Racionais Mcs  ',
      uploader: 'Andre Coutinho',
      duration: 530,
    },
  ],
});

describe('importador: parse e filtros do yt-dlp', () => {
  it('deixa só vídeo de música, com URL canônica e capa estável', async () => {
    const { parseResultados } = await carregarModulo();
    expect(parseResultados(SAIDA_YTDLP)).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=fgysUhl98As',
        titulo: 'Eu sou 157 - Nada Como Um Dia Após O Outro Dia (Chora Agora)',
        canal: 'Racionais TV',
        duracaoSeg: 532,
        capa: 'https://i.ytimg.com/vi/fgysUhl98As/hqdefault.jpg',
      },
      {
        url: 'https://www.youtube.com/watch?v=CsglWlcZTio',
        titulo: 'Eu sou 157 - Racionais Mcs',
        canal: 'Andre Coutinho',
        duracaoSeg: 530,
        capa: 'https://i.ytimg.com/vi/CsglWlcZTio/hqdefault.jpg',
      },
    ]);
  });

  it('nos limites: 60 s e 15 min entram; fora deles e sem duração, não', async () => {
    const { pareceMusica } = await carregarModulo();
    expect(pareceMusica({ duration: 60 })).toBe(true);
    expect(pareceMusica({ duration: 900 })).toBe(true);
    expect(pareceMusica({ duration: 59 })).toBe(false);
    expect(pareceMusica({ duration: 901 })).toBe(false);
    expect(pareceMusica({ duration: null })).toBe(false);
    expect(pareceMusica({ duration: 200, live_status: 'is_upcoming' })).toBe(false);
  });

  it('entrada estragada vira lista vazia, não exceção', async () => {
    const { parseResultados } = await carregarModulo();
    expect(parseResultados('<html>')).toEqual([]);
    expect(parseResultados({})).toEqual([]);
    expect(parseResultados(null)).toEqual([]);
  });
});

describe('importador: cache e limite por usuário', () => {
  it('repetir o termo (caixa e espaços diferentes) não roda o yt-dlp de novo', async () => {
    const { criarBuscaYoutube } = await carregarModulo();
    const rodar = vi.fn(() => Promise.resolve(SAIDA_YTDLP));
    const busca = criarBuscaYoutube({ rodar });
    const a = await busca.buscar('Racionais  eu sou 157', 'u1');
    const b = await busca.buscar('racionais eu sou 157', 'u2');
    expect(b).toBe(a);
    expect(rodar).toHaveBeenCalledTimes(1);
    expect(rodar).toHaveBeenCalledWith('Racionais eu sou 157', 10);
  });

  it('o cache vence em 10 min', async () => {
    const { criarBuscaYoutube } = await carregarModulo();
    let t = 0;
    const rodar = vi.fn(() => Promise.resolve(SAIDA_YTDLP));
    const busca = criarBuscaYoutube({ rodar, agora: () => t });
    await busca.buscar('x y', 'u1');
    t = 10 * 60_000 + 1;
    await busca.buscar('x y', 'u1');
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('o 11º termo novo no mesmo minuto é recusado, só para quem abusou', async () => {
    const { criarBuscaYoutube, LimiteDeBusca } = await carregarModulo();
    let t = 1_000_000;
    const busca = criarBuscaYoutube({ rodar: () => Promise.resolve('{}'), agora: () => t });
    for (let i = 0; i < 10; i++) await busca.buscar(`termo ${i}`, 'abusado');
    await expect(busca.buscar('termo 10', 'abusado')).rejects.toBeInstanceOf(LimiteDeBusca);
    // Outra pessoa segue buscando; e o que já está em cache não conta.
    await expect(busca.buscar('termo 10', 'outra')).resolves.toEqual([]);
    await expect(busca.buscar('termo 3', 'abusado')).resolves.toEqual([]);
    // Passado o minuto, volta.
    t += 60_001;
    await expect(busca.buscar('termo 11', 'abusado')).resolves.toEqual([]);
  });
});

describe('cliente: buscarNoYoutube', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    idToken.valor = 'tok-123';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('deslogado nem chama o importador', async () => {
    idToken.valor = null;
    await expect(buscarNoYoutube('x')).resolves.toEqual({ ok: false, motivo: 'login' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda o token e devolve os resultados validados', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          resultados: [
            {
              url: 'https://www.youtube.com/watch?v=fgysUhl98As',
              titulo: 'Eu sou 157',
              canal: 'Racionais TV',
              duracaoSeg: 532,
              capa: 'https://i.ytimg.com/vi/fgysUhl98As/hqdefault.jpg',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const r = await buscarNoYoutube('eu sou 157');
    expect(r).toEqual({
      ok: true,
      resultados: [
        {
          url: 'https://www.youtube.com/watch?v=fgysUhl98As',
          titulo: 'Eu sou 157',
          canal: 'Racionais TV',
          duracaoSeg: 532,
          capa: 'https://i.ytimg.com/vi/fgysUhl98As/hqdefault.jpg',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/buscar-youtube\?q=eu%20sou%20157$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it.each([
    [403, 'login'],
    [429, 'limite'],
    [502, 'falha'],
  ] as const)('HTTP %i vira motivo "%s"', async (status, motivo) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));
    await expect(buscarNoYoutube('x')).resolves.toEqual({ ok: false, motivo });
  });

  it('rede caída vira "falha", nunca exceção', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(buscarNoYoutube('x')).resolves.toEqual({ ok: false, motivo: 'falha' });
  });
});

describe('cliente: parse e faixa temporária', () => {
  beforeEach(() => {
    idToken.valor = 'tok-123';
  });

  it('descarta o que não é link do YouTube, sem título ou repetido', () => {
    expect(
      parseResultadosYoutube({
        resultados: [
          { url: 'https://youtu.be/fgysUhl98As', titulo: 'A', canal: 'C', duracaoSeg: 200 },
          { url: 'https://www.youtube.com/watch?v=fgysUhl98As', titulo: 'A de novo' },
          { url: 'https://evil.example/x', titulo: 'B' },
          { url: 'https://www.youtube.com/watch?v=CsglWlcZTio', titulo: '   ' },
          null,
          { url: 'https://www.youtube.com/watch?v=WjkBMTKkbQw', titulo: 'C', capa: 'http://x' },
        ],
      }),
    ).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=fgysUhl98As',
        titulo: 'A',
        canal: 'C',
        duracaoSeg: 200,
        capa: null,
      },
      {
        url: 'https://www.youtube.com/watch?v=WjkBMTKkbQw',
        titulo: 'C',
        canal: '',
        duracaoSeg: 0,
        capa: null,
      },
    ]);
    expect(parseResultadosYoutube('<html>')).toEqual([]);
  });

  it('videoIdDoYoutube entende watch, youtu.be e shorts', () => {
    expect(videoIdDoYoutube('https://www.youtube.com/watch?v=fgysUhl98As&t=3')).toBe('fgysUhl98As');
    expect(videoIdDoYoutube('https://youtu.be/fgysUhl98As')).toBe('fgysUhl98As');
    expect(videoIdDoYoutube('https://www.youtube.com/shorts/fgysUhl98As')).toBe('fgysUhl98As');
    expect(videoIdDoYoutube('https://www.youtube.com/watch?v=curto')).toBeNull();
    expect(videoIdDoYoutube('lixo')).toBeNull();
  });

  it('a faixa é `youtube:<id>` e toca pelo /stream com o token', async () => {
    const faixa = await faixaDoYoutube({
      url: 'https://www.youtube.com/watch?v=fgysUhl98As',
      titulo: 'Eu sou 157',
      canal: 'Racionais TV',
      duracaoSeg: 532,
      capa: 'https://i.ytimg.com/vi/fgysUhl98As/hqdefault.jpg',
    });
    expect(faixa).toMatchObject({
      id: 'youtube:fgysUhl98As',
      title: 'Eu sou 157',
      durationMs: 532_000,
      artists: [{ name: 'Racionais TV' }],
      sourceUrl: 'https://www.youtube.com/watch?v=fgysUhl98As',
    });
    expect(faixa?.streamUrl).toMatch(
      /\/stream\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DfgysUhl98As&token=tok-123&quality=high$/,
    );
  });

  it('deslogado não monta faixa (o /stream recusaria)', async () => {
    idToken.valor = null;
    await expect(
      faixaDoYoutube({
        url: 'https://www.youtube.com/watch?v=fgysUhl98As',
        titulo: 'x',
        canal: '',
        duracaoSeg: 100,
        capa: null,
      }),
    ).resolves.toBeNull();
  });
});
