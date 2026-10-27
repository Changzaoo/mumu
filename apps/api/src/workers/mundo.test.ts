/**
 * O mundo da música: as decisões puras — quem é o artista, o que vira evento,
 * como shows repetidos se fundem, o que a ficha ignora.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  env: {
    MUNDO_USER_AGENT: 'teste',
    MUNDO_REFRESH_HORAS: 24,
    MUNDO_MAX_CHAMADAS_DIA: 100,
    MUNDO_ARTISTAS_POR_BATIDA: 2,
  },
}));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: {} }));

const fontes = await import('./mundo.fontes.js');
const { fichasDosNomes } = await import('./mundo.worker.js');

describe('escolher o artista na MusicBrainz', () => {
  it('só aceita quem tem a mesma identidade de nome, o de maior pontuação', () => {
    const escolhido = fontes.escolherArtistaMB('Matuê', [
      { id: 'a', name: 'Matue', score: 80 },
      { id: 'b', name: 'Matuê', score: 100 },
      { id: 'c', name: 'Matuê & Teto', score: 95 },
    ]);
    expect(escolhido?.id).toBe('b');
  });

  it('apelido também identifica; sem casamento exato não escolhe ninguém', () => {
    expect(
      fontes.escolherArtistaMB('Kennedi', [
        { id: 'x', name: 'DJ Kennedi', aliases: [{ name: 'Kennedi' }] },
      ])?.id,
    ).toBe('x');
    expect(
      fontes.escolherArtistaMB('Anitta', [{ id: 'y', name: 'Anita Baker', score: 100 }]),
    ).toBeNull();
  });
});

describe('links e ids das relações', () => {
  it('lê wikidata, youtube, bandsintown e instagram das url-rels', () => {
    const links = fontes.linksDasRelacoes([
      { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q7366' } },
      {
        type: 'youtube',
        url: { resource: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv' },
      },
      { type: 'bandsintown', url: { resource: 'https://www.bandsintown.com/a/1' } },
      { type: 'social network', url: { resource: 'https://www.instagram.com/x' } },
      { type: 'streaming', url: { resource: 'https://open.spotify.com/artist/1' } },
    ]);
    expect(links.wikidata).toContain('Q7366');
    expect(fontes.idDoWikidata(links.wikidata)).toBe('Q7366');
    expect(fontes.canalDoYoutube(links.youtube)).toBe('UCabcdefghijklmnopqrstuv');
    expect(links.bandsintown).toBeDefined();
    expect(links.instagram).toBeDefined();
    expect(links.spotify).toBeDefined();
    expect(fontes.canalDoYoutube('https://www.youtube.com/@matue')).toBeNull();
  });
});

describe('datas parciais', () => {
  it('dia completo vira data; mês vira dia 1; só o ano não vira nada', () => {
    expect(fontes.dataParcial('2026-11-12')?.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(fontes.dataParcial('2026-11')?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(fontes.dataParcial('2026')).toBeNull();
    // Precisão de ano do Wikidata: não vira "30 de novembro do ano anterior".
    expect(fontes.dataParcial('+2023-00-00T00:00:00Z')).toBeNull();
    expect(fontes.dataParcial('+2023-05-00T00:00:00Z')?.toISOString().slice(0, 10)).toBe(
      '2023-05-01',
    );
    expect(fontes.dataParcial('')).toBeNull();
  });
});

describe('eventos das fontes', () => {
  it('lançamento do MusicBrainz com tipo e data', () => {
    const e = fontes.lancamentoDoMB({
      id: 'rg1',
      title: 'Máquina do Tempo',
      'primary-type': 'Album',
      'first-release-date': '2020-09-10',
    });
    expect(e).toMatchObject({ tipo: 'LANCAMENTO', titulo: 'Máquina do Tempo', descricao: 'Álbum' });
    expect(e?.quando?.toISOString().slice(0, 10)).toBe('2020-09-10');
  });

  it('evento do MusicBrainz com lugar, cidade e hora; cancelado não entra', () => {
    const e = fontes.eventoDoMB({
      id: 'ev1',
      name: 'Rock in Rio 2026',
      type: 'Festival',
      time: '20:30',
      'life-span': { begin: '2026-09-19' },
      relations: [
        {
          'target-type': 'place',
          place: { name: 'Cidade do Rock', area: { name: 'Rio de Janeiro' } },
        },
      ],
    });
    expect(e).toMatchObject({
      tipo: 'FESTIVAL',
      local: 'Cidade do Rock · Rio de Janeiro',
      cidade: 'Rio de Janeiro',
    });
    expect(e?.quando?.toISOString()).toBe('2026-09-19T20:30:00.000Z');
    expect(fontes.eventoDoMB({ id: 'ev2', name: 'x', cancelled: true })).toBeNull();
  });

  it('prêmios do Wikidata: recebidos e indicações, com data e obra', () => {
    const brutos = fontes.premiosDaEntidade({
      claims: {
        P166: [
          {
            mainsnak: { datavalue: { value: { id: 'Q41254' } } },
            qualifiers: {
              P585: [{ datavalue: { value: { time: '+2021-11-18T00:00:00Z' } } }],
              P1686: [{ datavalue: { value: { id: 'Q999' } } }],
            },
          },
        ],
        P1411: [{ mainsnak: { datavalue: { value: { id: 'Q41254' } } } }],
      },
    });
    expect(brutos).toHaveLength(2);
    expect(brutos[0]).toMatchObject({ premioId: 'Q41254', obraId: 'Q999', indicacao: false });
    expect(brutos[0]?.quando?.toISOString().slice(0, 10)).toBe('2021-11-18');
    expect(brutos[1]).toMatchObject({ indicacao: true, quando: null });
  });

  it('show do Bandsintown com local, cidade e link de ingresso', () => {
    const e = fontes.showDoBandsintown({
      id: '77',
      url: 'https://www.bandsintown.com/e/77',
      datetime: '2026-11-20T21:00:00',
      venue: { name: 'Espaço Unimed', city: 'São Paulo', region: 'SP', country: 'Brazil' },
      offers: [{ type: 'Tickets', url: 'https://ingressos.test/77', status: 'available' }],
      lineup: ['Matuê'],
    });
    expect(e).toMatchObject({
      tipo: 'SHOW',
      local: 'Espaço Unimed · São Paulo, SP',
      cidade: 'São Paulo, SP',
      linkIngresso: 'https://ingressos.test/77',
      fonte: 'bandsintown',
    });
  });

  it('show do Ticketmaster só quando o artista é atração; preço como faixa', () => {
    const base = {
      id: 'tm1',
      name: 'Matuê em SP',
      url: 'https://tm.test/1',
      dates: { start: { dateTime: '2026-11-20T23:00:00Z' } },
      priceRanges: [{ min: 120, max: 480, currency: 'BRL' }],
      _embedded: {
        venues: [
          { name: 'Espaço Unimed', city: { name: 'São Paulo' }, country: { countryCode: 'BR' } },
        ],
        attractions: [{ name: 'Matuê' }],
      },
    };
    const e = fontes.showDoTicketmaster('Matuê', base);
    expect(e).toMatchObject({
      tipo: 'SHOW',
      preco: 'R$120 – R$480',
      linkIngresso: 'https://tm.test/1',
      pais: 'BR',
    });
    expect(fontes.showDoTicketmaster('Teto', base)).toBeNull();
    expect(fontes.faixaDePreco([{ min: 50, max: 50, currency: 'BRL' }])).toBe('R$50');
    expect(fontes.faixaDePreco([])).toBeNull();
  });

  it('o mesmo show em duas fontes vira um só, com o preço e o link de quem tem', () => {
    const quando = new Date('2026-11-20T23:00:00Z');
    const fundidos = fontes.fundirShows([
      {
        id: 'bandsintown:1',
        tipo: 'SHOW',
        titulo: 'Show',
        quando,
        cidade: 'São Paulo, SP',
        linkIngresso: 'https://b.test',
        fonte: 'bandsintown',
      },
      {
        id: 'ticketmaster:1',
        tipo: 'SHOW',
        titulo: 'Show',
        quando,
        cidade: 'Sao Paulo',
        preco: 'R$120',
        fonte: 'ticketmaster',
      },
      {
        id: 'musicbrainz:event:1',
        tipo: 'FESTIVAL',
        titulo: 'Festival',
        quando: null,
        fonte: 'musicbrainz',
      },
    ]);
    expect(fundidos).toHaveLength(2);
    const show = fundidos.find((e) => e.id === 'bandsintown:1');
    expect(show).toMatchObject({ preco: 'R$120', linkIngresso: 'https://b.test' });
  });

  it('feed do YouTube: lê vídeos e separa o que parece show', () => {
    const xml = `<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>Matu&#39;s Tour - Ao Vivo em SP</title><published>2026-10-01T00:00:00+00:00</published></entry><entry><yt:videoId>lmnopqrstuv</yt:videoId><title>Clipe oficial</title><published>2026-10-02T00:00:00+00:00</published></entry></feed>`;
    const videos = fontes.videosDoFeed(xml);
    expect(videos).toHaveLength(2);
    expect(videos[0]?.titulo).toBe("Matu's Tour - Ao Vivo em SP");
    expect(fontes.transmissoesDoFeed(videos).map((v) => v.id)).toEqual(['abcdefghijk']);
  });
});

describe('orçamento', () => {
  it('conta cada chamada e nega depois do teto', () => {
    const orc = new fontes.Orcamento(2);
    expect(orc.gastar()).toBe(true);
    expect(orc.gastar()).toBe(true);
    expect(orc.gastar()).toBe(false);
    expect(orc.esgotado).toBe(true);
    expect(orc.gastas).toBe(2);
  });
});

describe('fichas a partir dos nomes do acervo', () => {
  it('uma ficha por identidade, com a grafia mais frequente; selo e vazio ficam de fora', () => {
    const fichas = fichasDosNomes(
      [
        { nome: 'DJ Kennedi', faixas: 3 },
        { nome: 'Kennedi', faixas: 7 },
        { nome: 'MK Music', faixas: 20 },
        { nome: 'Desconhecido', faixas: 50 },
        { nome: '  ', faixas: 1 },
        { nome: 'Matuê', faixas: 40 },
      ],
      new Map([['matue', 2]]),
    );
    const porChave = new Map(fichas.map((f) => [f.chave, f]));
    expect(porChave.get('kennedi')).toMatchObject({ nome: 'Kennedi', prioridade: 10 });
    expect(porChave.get('matue')).toMatchObject({ nome: 'Matuê', prioridade: 2040 });
    expect(porChave.has('mkmusic')).toBe(false);
    expect(porChave.has('desconhecido')).toBe(false);
  });

  it('seguido sem faixa no acervo também ganha ficha', () => {
    const fichas = fichasDosNomes([], new Map([['anitta', 1]]));
    expect(fichas).toEqual([{ chave: 'anitta', nome: 'anitta', prioridade: 1000 }]);
  });
});
