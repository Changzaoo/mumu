// O resolvedor com a rede SIMULADA pelas respostas gravadas (__fixtures__):
// `node --test apps/importer/resolverDeMusica.test.mjs`. Confere que só hosts
// da lista são pedidos, que o song.link sem chave cai no caminho dos
// metadados, e que música sem par seguro vira erro — nunca palpite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarResolvedorDeMusica, buscarNaLista, NaoAchei } from './resolverDeMusica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(path.join(AQUI, '__fixtures__', n), 'utf8');

const ROTAS = {
  'https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b':
    'sp-track-0VjIjW4GlUZAMYd2vXMi3b.html',
  'https://open.spotify.com/embed/album/4yP0hdKOZPNshxUOjY0cZj':
    'sp-album-4yP0hdKOZPNshxUOjY0cZj.html',
  'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M':
    'sp-playlist-37i9dQZF1DXcBWIGoYBM5M.html',
  'https://api.deezer.com/track/3135556': 'dz-track-3135556.json',
  'https://api.deezer.com/album/302127': 'dz-album-302127.json',
  'https://api.deezer.com/playlist/908622995': 'dz-playlist-908622995.json',
  'https://itunes.apple.com/lookup?id=1499378615&country=BR': 'it-lookup-1499378615.json',
};

function redeGravada() {
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(url);
    const u = new URL(url);
    if (u.hostname === 'api.song.link') {
      return new Response(fx('songlink-401-deprecated.json'), { status: 401 });
    }
    if (u.hostname === 'itunes.apple.com' && u.searchParams.get('entity') === 'song') {
      return new Response(fx('it-lookup-album-1499378108.json'), { status: 200 });
    }
    const arq = ROTAS[url];
    return arq ? new Response(fx(arq), { status: 200 }) : new Response('{}', { status: 404 });
  };
  return { f, pedidos };
}

const video = (titulo, canal, duracaoSeg, id) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  titulo,
  canal,
  duracaoSeg,
});

test('faixa do Spotify: song.link recusa (401) → embed → busca → vídeo canônico', async () => {
  const { f, pedidos } = redeGravada();
  const termos = [];
  const res = criarResolvedorDeMusica({
    fetch: f,
    buscar: async (termo) => {
      termos.push(termo);
      return [
        video('Blinding Lights (sped up)', 'x', 170, 'a1111111111'),
        video('The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd', 201, '4NRXx6U8ABQ'),
      ];
    },
  });
  const r = await res.resolverFaixa(
    'https://open.spotify.com/intl-pt/track/0VjIjW4GlUZAMYd2vXMi3b?si=z',
  );
  assert.equal(r.url, 'https://www.youtube.com/watch?v=4NRXx6U8ABQ');
  assert.equal(r.meta.titulo, 'Blinding Lights');
  assert.deepEqual(termos, ['The Weeknd Blinding Lights']);
  for (const p of pedidos) {
    assert.ok(['api.song.link', 'open.spotify.com'].includes(new URL(p).hostname), p);
  }
  // Segunda vez: cache (nem song.link, nem busca).
  const antes = pedidos.length;
  await res.resolverFaixa('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b');
  assert.equal(pedidos.length, antes);
  assert.equal(termos.length, 1);
});

test('song.link 401 desliga o atalho por horas (não martela a API)', async () => {
  const { f, pedidos } = redeGravada();
  const res = criarResolvedorDeMusica({
    fetch: f,
    buscar: async () => [
      video('Harder, Better, Faster, Stronger', 'Daft Punk', 226, 'gAjR4_CbPpQ'),
    ],
  });
  await res.resolverFaixa('https://www.deezer.com/track/3135556');
  await res
    .resolverFaixa('https://music.apple.com/br/album/after-hours/1499378108?i=1499378615')
    .catch(() => null);
  assert.equal(pedidos.filter((p) => p.includes('api.song.link')).length, 1);
});

test('sem par seguro → NaoAchei (nunca palpite)', async () => {
  const { f } = redeGravada();
  const res = criarResolvedorDeMusica({
    fetch: f,
    buscar: async () => [video('Blinding Lights (Remix)', 'DJ', 200, 'a1111111111')],
  });
  await assert.rejects(
    res.resolverFaixa('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'),
    NaoAchei,
  );
});

test('song.link COM vídeo: passa pelo portão, e metadados vêm do serviço', async () => {
  const f = async (url) => {
    if (url.startsWith('https://api.song.link/')) {
      assert.match(url, /key=CHAVE/);
      return new Response(
        JSON.stringify({
          entityUniqueId: 'S',
          entitiesByUniqueId: { S: { type: 'song', title: 'x', artistName: 'y' } },
          linksByPlatform: {
            youtube: { url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ&list=PLabcdefghij' },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(fx('sp-track-0VjIjW4GlUZAMYd2vXMi3b.html'), { status: 200 });
  };
  const res = criarResolvedorDeMusica({
    fetch: f,
    chaveSongLink: 'CHAVE',
    buscar: async () => assert.fail('não devia buscar'),
  });
  const r = await res.resolverFaixa('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b');
  assert.equal(r.url, 'https://www.youtube.com/watch?v=4NRXx6U8ABQ');
  assert.equal(r.meta.duracaoMs, 200040);
});

test('song.link devolvendo link que não é vídeo do YouTube: portão recusa', async () => {
  const f = async (url) =>
    url.startsWith('https://api.song.link/')
      ? new Response(
          JSON.stringify({
            linksByPlatform: {
              youtube: { url: 'https://www.youtube.com/redirect?q=http://10.0.0.1' },
            },
          }),
          { status: 200 },
        )
      : new Response(fx('sp-track-0VjIjW4GlUZAMYd2vXMi3b.html'), { status: 200 });
  const res = criarResolvedorDeMusica({ fetch: f, chaveSongLink: 'k', buscar: async () => [] });
  await assert.rejects(
    res.resolverFaixa('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'),
    NaoAchei,
  );
});

test('link curto sem song.link: pede o endereço completo, sem abrir o curto', async () => {
  const { f, pedidos } = redeGravada();
  const res = criarResolvedorDeMusica({ fetch: f, buscar: async () => [] });
  await assert.rejects(res.resolverFaixa('https://spotify.link/AbCd1234'), /endereço completo/);
  assert.ok(
    pedidos.every(
      (p) => !p.includes('spotify.link/AbCd') || p.startsWith('https://api.song.link/'),
    ),
  );
});

test('álbum/playlist → links de FAIXA do serviço, com teto e metadados guardados', async () => {
  const { f, pedidos } = redeGravada();
  const res = criarResolvedorDeMusica({
    fetch: f,
    maxLista: 10,
    buscar: async () => [video('The Weeknd - Alone Again', 'The Weeknd', 250, 'b2222222222')],
  });
  const al = await res.listar('https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj');
  assert.equal(al.title, 'After Hours');
  assert.equal(al.entries.length, 10);
  assert.equal(al.entries[0].url, 'https://open.spotify.com/track/6b5P51m8xx2XA6U7sdNZ5E');
  assert.equal(al.entries[0].title, 'The Weeknd - Alone Again');
  // A faixa da lista resolve sem pedir o embed de novo.
  const antes = pedidos.filter((p) => p.includes('/embed/track/')).length;
  const r = await res.resolverFaixa(al.entries[0].url);
  assert.equal(r.url, 'https://www.youtube.com/watch?v=b2222222222');
  assert.equal(r.meta.album, 'After Hours');
  assert.equal(pedidos.filter((p) => p.includes('/embed/track/')).length, antes);

  const dz = await res.listar('https://www.deezer.com/br/playlist/908622995');
  assert.equal(dz.entries.length, 10);
  const pl = await res.listar('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(pl.entries.length, 10);
  const ap = await res.listar('https://music.apple.com/br/album/after-hours/1499378108');
  assert.equal(ap.entries.length, 10);
  assert.match(ap.entries[0].url, /^https:\/\/music\.apple\.com\/br\/song\/\d+$/);
});

test('Apple playlist e Tidal álbum: erro claro', async () => {
  const res = criarResolvedorDeMusica({ fetch: redeGravada().f, buscar: async () => [] });
  await assert.rejects(
    res.listar('https://music.apple.com/br/playlist/x/pl.f4d106fed2bd41149aaacabb233eb5eb'),
    NaoAchei,
  );
  await assert.rejects(res.listar('https://tidal.com/browse/album/77646164'), NaoAchei);
  await assert.rejects(res.resolverFaixa('https://tidal.com/browse/track/77646168'), /Tidal/);
});

test('buscarNaLista recusa host fora da lista e http', async () => {
  const f = async () => assert.fail('não devia pedir');
  await assert.rejects(buscarNaLista('https://evil.com/x', { fetch: f }), /fora da lista/);
  await assert.rejects(
    buscarNaLista('http://api.deezer.com/track/1', { fetch: f }),
    /fora da lista/,
  );
  await assert.rejects(buscarNaLista('https://spotify.link/abc', { fetch: f }), /fora da lista/);
});

test('artista do Spotify (link intl-pt): mais tocadas do embed + as do Deezer, sem repetir', async () => {
  const embed = (entidade) =>
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity: entidade } } } },
    })}</script></html>`;
  const trackUri = (n) => `spotify:track:${String(n).padStart(22, 'A')}`;
  const respostas = {
    'https://open.spotify.com/embed/artist/2q9wk5fkeU2C9CgCKdh4AN': embed({
      type: 'artist',
      name: 'MC Exemplo',
      trackList: [
        { uri: trackUri(1), title: 'Hit Um', subtitle: 'MC Exemplo', duration: 180000 },
        { uri: trackUri(2), title: 'Hit Dois', subtitle: 'MC Exemplo', duration: 190000 },
      ],
    }),
    'https://api.deezer.com/search/artist?q=MC%20Exemplo&limit=5': JSON.stringify({
      data: [
        { id: 999, name: 'Outro' },
        { id: 123, name: 'MC Exemplo' },
      ],
    }),
    'https://api.deezer.com/artist/123/top?limit=100': JSON.stringify({
      data: [
        { id: 11, title: 'Hit Um', duration: 180, artist: { name: 'MC Exemplo' }, album: {} },
        { id: 12, title: 'Faixa Três', duration: 200, artist: { name: 'MC Exemplo' }, album: {} },
      ],
    }),
  };
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(url);
    const corpo = respostas[url];
    return {
      status: corpo ? 200 : 404,
      headers: new Headers(),
      text: async () => corpo ?? '',
    };
  };
  const res = criarResolvedorDeMusica({ fetch: f, buscar: async () => [] });
  const r = await res.listar('https://open.spotify.com/intl-pt/artist/2q9wk5fkeU2C9CgCKdh4AN');
  assert.equal(r.title, 'MC Exemplo · discografia');
  assert.deepEqual(
    r.entries.map((e) => e.title),
    ['MC Exemplo - Hit Um', 'MC Exemplo - Hit Dois', 'MC Exemplo - Faixa Três'],
  );
  for (const p of pedidos) {
    assert.ok(['open.spotify.com', 'api.deezer.com'].includes(new URL(p).hostname), p);
  }
});

/** Rede simulada por tabela url → corpo; `null` na tabela = a fonte caiu. */
function redeDeTabela(respostas) {
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(url);
    if (respostas[url] === null) throw new TypeError('fetch failed');
    const corpo = respostas[url];
    return {
      status: corpo ? 200 : 404,
      headers: new Headers(),
      text: async () => corpo ?? '',
    };
  };
  return { f, pedidos };
}

const itemDz = (id, title, artistaId = 123) => ({
  id,
  title,
  duration: 200,
  artist: { id: artistaId, name: artistaId === 123 ? 'MC Exemplo' : 'Outro' },
});

test('artista do Deezer: mais tocadas + discografia inteira (álbuns em páginas), sem coletânea, sem repetir, no teto', async () => {
  const { f, pedidos } = redeDeTabela({
    'https://api.deezer.com/artist/123': JSON.stringify({ id: 123, name: 'MC Exemplo' }),
    'https://api.deezer.com/artist/123/top?limit=100': JSON.stringify({
      data: [{ ...itemDz(11, 'Hit Um'), album: { title: 'Disco A' } }],
    }),
    'https://api.deezer.com/artist/123/albums?index=0&limit=100': JSON.stringify({
      data: [
        { id: 1, title: 'Disco A', record_type: 'album', cover_xl: 'https://c/a.jpg' },
        { id: 2, title: 'Coletânea', record_type: 'compile' },
      ],
      next: 'https://api.deezer.com/artist/123/albums?index=2',
    }),
    'https://api.deezer.com/artist/123/albums?index=2&limit=100': JSON.stringify({
      data: [{ id: 3, title: 'Single B', record_type: 'single' }],
    }),
    'https://api.deezer.com/album/1/tracks?limit=100': JSON.stringify({
      data: [
        itemDz(11, 'Hit Um'),
        itemDz(13, 'Lado B'),
        itemDz(14, 'Participação', 999), // disco dele, faixa de outro artista
      ],
    }),
    'https://api.deezer.com/album/3/tracks?limit=100': JSON.stringify({
      data: [itemDz(15, 'Single B (Remix)'), itemDz(16, 'Nova')],
    }),
  });
  const res = criarResolvedorDeMusica({ fetch: f, buscar: async () => [] });
  const r = await res.listar('https://www.deezer.com/br/artist/123');
  assert.deepEqual(
    r.entries.map((e) => e.url),
    [
      'https://www.deezer.com/track/11',
      'https://www.deezer.com/track/13',
      'https://www.deezer.com/track/15',
      'https://www.deezer.com/track/16',
    ],
  );
  assert.ok(!pedidos.some((p) => p.includes('/album/2/')), 'coletânea não é pedida');

  // Teto: com maxLista=2 para no meio e nem pede o resto da discografia.
  const curto = redeDeTabela({
    'https://api.deezer.com/artist/123': JSON.stringify({ name: 'MC Exemplo' }),
    'https://api.deezer.com/artist/123/top?limit=2': JSON.stringify({
      data: [itemDz(11, 'Hit Um'), itemDz(12, 'Hit Dois'), itemDz(13, 'Hit Três')],
    }),
  });
  const res2 = criarResolvedorDeMusica({ fetch: curto.f, buscar: async () => [], maxLista: 2 });
  const r2 = await res2.listar('https://www.deezer.com/artist/123');
  assert.equal(r2.entries.length, 2);
  assert.ok(!curto.pedidos.some((p) => p.includes('/albums')));
});

test('artista: fonte fora do ar é erro comum (re-tenta); artista sem músicas é NaoAchei', async () => {
  const caiu = redeDeTabela({
    'https://open.spotify.com/embed/artist/2q9wk5fkeU2C9CgCKdh4AN': null,
  });
  const res = criarResolvedorDeMusica({ fetch: caiu.f, buscar: async () => [] });
  const erro = await res
    .listar('https://open.spotify.com/artist/2q9wk5fkeU2C9CgCKdh4AN')
    .catch((e) => e);
  assert.ok(erro instanceof Error && !(erro instanceof NaoAchei), String(erro));

  const vazio = redeDeTabela({
    'https://api.deezer.com/artist/123': JSON.stringify({ name: 'MC Exemplo' }),
    'https://api.deezer.com/artist/123/top?limit=100': JSON.stringify({ data: [] }),
    'https://api.deezer.com/artist/123/albums?index=0&limit=100': JSON.stringify({ data: [] }),
  });
  const res2 = criarResolvedorDeMusica({ fetch: vazio.f, buscar: async () => [] });
  await assert.rejects(res2.listar('https://www.deezer.com/artist/123'), NaoAchei);
});
