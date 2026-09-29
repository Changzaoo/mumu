import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BioIndisponivel,
  ehArtistaMusical,
  fetchArtistBio,
  looksMusical,
  mesmoNome,
  normalizarNome,
  type WdEntity,
} from '@/lib/artistBio';

describe('looksMusical', () => {
  it('aceita verbete de artista (pt e en)', () => {
    expect(looksMusical('Anitta é uma cantora e compositora brasileira.')).toBe(true);
    expect(looksMusical('Queen foi uma banda britânica de rock.')).toBe(true);
    expect(looksMusical('Queen were a British rock band formed in 1970.')).toBe(true);
    expect(looksMusical('Racionais MC’s é um grupo musical de rap de São Paulo.')).toBe(true);
  });

  it('usa a descrição quando o resumo não diz nada', () => {
    expect(looksMusical('Formado em 1991 em Belo Horizonte.', 'banda brasileira')).toBe(true);
  });

  it('rejeita homônimo — "populosa" não faz de uma cidade uma banda', () => {
    expect(looksMusical('Fresno é a quinta cidade mais populosa do estado da Califórnia.')).toBe(
      false,
    );
    expect(looksMusical('Foi erguida uma bandeira no alto do morro.')).toBe(false);
    expect(looksMusical('O trem chegou rapidamente à estação.')).toBe(false);
  });

  it('rejeita texto vazio', () => {
    expect(looksMusical(null, undefined, '')).toBe(false);
  });
});

// ------------------------------------------------------------ Wikidata fake

const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const str = (value: string) => ({ mainsnak: { datavalue: { value } } });

function entidade(
  id: string,
  label: string,
  opts: {
    ocupacoes?: string[];
    tipos?: string[];
    ids?: string[];
    aliases?: string[];
    sitelinks?: Record<string, string>;
    extras?: number;
  } = {},
): WdEntity {
  const claims: WdEntity['claims'] = {};
  if (opts.ocupacoes) claims.P106 = opts.ocupacoes.map(item);
  if (opts.tipos) claims.P31 = opts.tipos.map(item);
  for (const p of opts.ids ?? []) claims[p] = [str('x')];
  const sitelinks: WdEntity['sitelinks'] = {};
  for (const [site, title] of Object.entries(opts.sitelinks ?? {})) sitelinks[site] = { title };
  // Sitelinks extras só pesam na notoriedade (desempate).
  for (let i = 0; i < (opts.extras ?? 0); i++) sitelinks[`x${i}wiki`] = { title: label };
  return {
    id,
    labels: { pt: { value: label } },
    aliases: opts.aliases ? { pt: opts.aliases.map((value) => ({ value })) } : undefined,
    claims,
    sitelinks,
  };
}

interface Mundo {
  busca: Record<string, string[]>; // idioma → ids
  entidades: WdEntity[];
  resumos: Record<string, { extract: string; wikibase_item?: string; type?: string }>; // "pt:Título"
}

function simular(mundo: Mundo) {
  const chamadas: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    chamadas.push(url.toString());
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.hostname === 'www.wikidata.org') {
      const action = url.searchParams.get('action');
      if (action === 'wbsearchentities') {
        const lang = url.searchParams.get('language') ?? '';
        return json({ search: (mundo.busca[lang] ?? []).map((id) => ({ id })) });
      }
      if (action === 'wbgetentities') {
        const ids = (url.searchParams.get('ids') ?? '').split('|');
        const entities = Object.fromEntries(
          mundo.entidades.filter((e) => ids.includes(e.id!)).map((e) => [e.id, e]),
        );
        return json({ entities });
      }
    }
    const m = /^([a-z]+)\.wikipedia\.org$/.exec(url.hostname);
    if (m) {
      const title = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const r = mundo.resumos[`${m[1]}:${title}`];
      if (!r) return json({}, 404);
      return json({
        title,
        type: r.type ?? 'standard',
        extract: r.extract,
        wikibase_item: r.wikibase_item,
        content_urls: { desktop: { page: `https://${m[1]}.wikipedia.org/wiki/${title}` } },
        originalimage: { source: 'https://upload.wikimedia.org/foto.jpg' },
      });
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const CANTOR = 'Q177220';
const BANDA_ROCK = 'Q5741069';

describe('normalizarNome / mesmoNome', () => {
  it('ignora acento, pontuação, "&" e o artigo "The"', () => {
    expect(normalizarNome('Racionais MC’s')).toBe(normalizarNome("Racionais MC's"));
    expect(normalizarNome('The Beatles')).toBe('beatles');
    expect(normalizarNome('Zé Neto & Cristiano')).toBe(normalizarNome('Ze Neto e Cristiano'));
  });

  it('casa por apelido, não por pedaço do nome', () => {
    const e = entidade('Q1', 'Larissa de Macedo Machado', { aliases: ['Anitta'] });
    expect(mesmoNome(e, 'anitta')).toBe(true);
    expect(mesmoNome(e, 'Larissa')).toBe(false);
  });
});

describe('ehArtistaMusical', () => {
  it('aceita por ocupação, por tipo de grupo ou por MusicBrainz + streaming', () => {
    expect(ehArtistaMusical(entidade('Q1', 'A', { ocupacoes: [CANTOR] }))).toBe(true);
    expect(ehArtistaMusical(entidade('Q2', 'B', { tipos: [BANDA_ROCK] }))).toBe(true);
    expect(ehArtistaMusical(entidade('Q3', 'C', { ids: ['P434', 'P1902'] }))).toBe(true);
  });

  it('rejeita cidade, jogador e ID de artista sozinho', () => {
    expect(ehArtistaMusical(entidade('Q4', 'Fresno', { tipos: ['Q515'] }))).toBe(false);
    expect(ehArtistaMusical(entidade('Q5', 'Ronaldo', { ocupacoes: ['Q937857'] }))).toBe(false);
    expect(ehArtistaMusical(entidade('Q6', 'D', { ids: ['P434'] }))).toBe(false);
  });
});

describe('fetchArtistBio — desambiguação', () => {
  it('Fresno: pula a cidade e fica com a banda, em pt', async () => {
    simular({
      busca: { pt: ['Q43301', 'Q1476932'] },
      entidades: [
        entidade('Q43301', 'Fresno', {
          tipos: ['Q515'],
          sitelinks: { ptwiki: 'Fresno' },
          extras: 80,
        }),
        entidade('Q1476932', 'Fresno', {
          tipos: [BANDA_ROCK],
          sitelinks: { ptwiki: 'Fresno (banda)', enwiki: 'Fresno (band)' },
        }),
      ],
      resumos: {
        'pt:Fresno': { extract: 'Fresno é uma cidade da Califórnia.', wikibase_item: 'Q43301' },
        'pt:Fresno (banda)': {
          extract: 'Fresno é uma banda brasileira de rock formada em Porto Alegre.',
          wikibase_item: 'Q1476932',
        },
      },
    });
    const bio = await fetchArtistBio('Fresno');
    expect(bio?.qid).toBe('Q1476932');
    expect(bio?.lang).toBe('pt');
    expect(bio?.text).toMatch(/banda brasileira/);
    expect(bio?.imageUrl).toBe('https://upload.wikimedia.org/foto.jpg');
  });

  it('não aceita verbete de OUTRA cantora só porque fala de música (o bug antigo)', async () => {
    // A busca devolve uma parceira famosa; ela é musical, mas não tem o nome.
    simular({
      busca: { pt: ['Q3123'], en: ['Q3123'] },
      entidades: [
        entidade('Q3123', 'Anitta', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Anitta' } }),
      ],
      resumos: { 'pt:Anitta': { extract: 'Anitta é uma cantora brasileira.' } },
    });
    expect(await fetchArtistBio('MC Desconhecida')).toBeNull();
  });

  it('cai para en quando não há verbete em pt', async () => {
    simular({
      busca: { pt: ['Q9'] },
      entidades: [
        entidade('Q9', 'Phoebe Bridgers', {
          ocupacoes: [CANTOR],
          sitelinks: { enwiki: 'Phoebe Bridgers' },
        }),
      ],
      resumos: {
        'en:Phoebe Bridgers': { extract: 'Phoebe Bridgers is an American singer-songwriter.' },
      },
    });
    const bio = await fetchArtistBio('Phoebe Bridgers');
    expect(bio?.lang).toBe('en');
  });

  it('homônimos musicais: desempata pela faixa do acervo citada no verbete', async () => {
    simular({
      busca: { pt: ['Q10', 'Q11'] },
      entidades: [
        entidade('Q10', 'Luan', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Luan (cantor)' } }),
        entidade('Q11', 'Luan', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Luan (rapper)' } }),
      ],
      resumos: {
        'pt:Luan (cantor)': { extract: 'Luan é um cantor conhecido por "Chuva de Arroz".' },
        'pt:Luan (rapper)': { extract: 'Luan é um rapper conhecido por "Outra Faixa".' },
      },
    });
    const bio = await fetchArtistBio('Luan', { titles: ['Outra Faixa', 'Ao Vivo'] });
    expect(bio?.qid).toBe('Q11');
  });

  it('homônimos musicais sem pista nem notoriedade clara: nada (melhor vazio que errado)', async () => {
    simular({
      busca: { pt: ['Q10', 'Q11'] },
      entidades: [
        entidade('Q10', 'Luan', {
          ocupacoes: [CANTOR],
          sitelinks: { ptwiki: 'Luan (cantor)' },
          extras: 4,
        }),
        entidade('Q11', 'Luan', {
          ocupacoes: [CANTOR],
          sitelinks: { ptwiki: 'Luan (rapper)' },
          extras: 3,
        }),
      ],
      resumos: {
        'pt:Luan (cantor)': { extract: 'Luan é um cantor.' },
        'pt:Luan (rapper)': { extract: 'Luan é um rapper.' },
      },
    });
    expect(await fetchArtistBio('Luan')).toBeNull();
  });

  it('homônimos musicais: aceita o esmagadoramente mais notório', async () => {
    simular({
      busca: { pt: ['Q11649', 'Q7040'] },
      entidades: [
        entidade('Q11649', 'Nirvana', {
          tipos: [BANDA_ROCK],
          sitelinks: { ptwiki: 'Nirvana (banda)' },
          extras: 90,
        }),
        entidade('Q7040', 'Nirvana', {
          tipos: [BANDA_ROCK],
          sitelinks: { enwiki: 'Nirvana (British band)' },
          extras: 5,
        }),
      ],
      resumos: { 'pt:Nirvana (banda)': { extract: 'Nirvana foi uma banda de Seattle.' } },
    });
    expect((await fetchArtistBio('Nirvana'))?.qid).toBe('Q11649');
  });

  it('recusa quando o verbete aponta para outro item (redirect trocou a pessoa)', async () => {
    simular({
      busca: { pt: ['Q20'] },
      entidades: [entidade('Q20', 'Xis', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Xis' } })],
      resumos: { 'pt:Xis': { extract: 'Xis é um cantor.', wikibase_item: 'Q999' } },
    });
    expect(await fetchArtistBio('Xis')).toBeNull();
  });

  it('recusa página de desambiguação', async () => {
    simular({
      busca: { pt: ['Q21'] },
      entidades: [entidade('Q21', 'Yo', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Yo' } })],
      resumos: { 'pt:Yo': { extract: 'Yo pode referir-se a:', type: 'disambiguation' } },
    });
    expect(await fetchArtistBio('Yo')).toBeNull();
  });

  it('gasta poucas requisições (busca + entidades + resumo)', async () => {
    const chamadas = simular({
      busca: { pt: ['Q30'] },
      entidades: [entidade('Q30', 'Zé', { ocupacoes: [CANTOR], sitelinks: { ptwiki: 'Zé' } })],
      resumos: { 'pt:Zé': { extract: 'Zé é um cantor.' } },
    });
    await fetchArtistBio('Zé');
    expect(chamadas).toHaveLength(3);
  });

  it('rede caída é BioIndisponivel, não "sem bio"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchArtistBio('Anitta')).rejects.toBeInstanceOf(BioIndisponivel);
  });
});
