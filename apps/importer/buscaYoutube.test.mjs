import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canaisDoInnertube,
  criarBuscaYoutube,
  parseCanais,
  parseResultados,
  resultadosDoInnertube,
} from './buscaYoutube.mjs';

// Saídas reais do yt-dlp (busca só de canais e aba de vídeos de um canal),
// enxugadas para os campos que o parse lê.
const canais = readFileSync(new URL('./__fixtures__/youtube-canais.json', import.meta.url), 'utf8');
const videos = readFileSync(
  new URL('./__fixtures__/youtube-canal-videos.json', import.meta.url),
  'utf8',
);

test('canais: viram artistas com foto https e inscritos; o espelho "- Topic" sai', () => {
  const artistas = parseCanais(canais);
  assert.ok(artistas.length >= 3);
  assert.deepEqual(artistas[0], {
    id: 'UCU06XOgERkQV7xCsrNLTf4Q',
    nome: 'MC Hariel',
    foto: artistas[0].foto,
    inscritos: 2410000,
  });
  assert.match(artistas[0].foto, /^https:\/\//);
  assert.ok(!artistas.some((a) => / - Topic$/.test(a.nome)));
  // A foto "//yt3.googleusercontent.com/..." ganha o https.
  assert.ok(artistas.every((a) => a.foto === null || a.foto.startsWith('https://')));
});

test('canais: entrada estranha não derruba nada', () => {
  assert.deepEqual(parseCanais('não é json'), []);
  assert.deepEqual(parseCanais({ entries: [null, { id: 'abc' }, { id: 'UCcurto' }] }), []);
});

test('vídeos do canal: o artista vem do topo da lista; show de 1h26 fica de fora', () => {
  const musicas = parseResultados(videos);
  assert.ok(musicas.length > 0);
  assert.ok(musicas.every((m) => m.canal === 'MC Hariel'));
  assert.ok(!musicas.some((m) => /Show Completo/.test(m.titulo)));
});

test('artistas e canal passam pelo mesmo cache: a segunda pergunta não roda yt-dlp', async () => {
  const pedidos = [];
  const busca = criarBuscaYoutube({
    rodar: async () => '{"entries":[]}',
    rodarUrl: async (url) => {
      pedidos.push(url);
      return url.includes('/videos') ? videos : canais;
    },
  });
  const a1 = await busca.buscarArtistas('mc hariel', 'u1');
  const a2 = await busca.buscarArtistas('MC Hariel ', 'u1');
  assert.equal(a1, a2);
  assert.match(pedidos[0], /search_query=mc%20hariel&sp=EgIQAg%3D%3D$/);

  const c1 = await busca.musicasDoCanal('UCU06XOgERkQV7xCsrNLTf4Q', 'u1');
  await busca.musicasDoCanal('UCU06XOgERkQV7xCsrNLTf4Q', 'u1');
  assert.equal(c1.nome, 'MC Hariel');
  assert.ok(c1.musicas.length > 0);
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1], 'https://www.youtube.com/channel/UCU06XOgERkQV7xCsrNLTf4Q/videos');
});

test('canal com id inválido não vira pedido ao YouTube', async () => {
  let rodou = false;
  const busca = criarBuscaYoutube({
    rodar: async () => '{}',
    rodarUrl: async () => {
      rodou = true;
      return '{}';
    },
  });
  assert.deepEqual(await busca.musicasDoCanal('../../etc', 'u1'), { nome: '', musicas: [] });
  assert.equal(rodou, false);
});

const respostaInnertube = {
  contents: {
    secoes: [
      {
        videoRenderer: {
          videoId: 'b7d6wnaRm2E',
          title: { runs: [{ text: 'Baby' }] },
          ownerText: { runs: [{ text: 'Gal Costa' }] },
          lengthText: { simpleText: '3:33' },
          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/b7d6wnaRm2E/hq720.jpg?x=1' }] },
        },
      },
      {
        videoRenderer: {
          videoId: 'Sc1hkI4jVU8',
          title: { runs: [{ text: 'Baby ao vivo' }] },
          ownerText: { runs: [{ text: 'Brasilidades' }] },
          lengthText: { simpleText: '3:53' },
          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/Sc1hkI4jVU8/hqdefault.jpg' }] },
        },
      },
      // Live não traz duração; show de 1h fica fora: nenhum dos dois é faixa.
      { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Live' }] } } },
      {
        videoRenderer: {
          videoId: 'bbbbbbbbbbb',
          title: { runs: [{ text: 'Show' }] },
          lengthText: { simpleText: '1:02:10' },
        },
      },
    ],
  },
};

test('InnerTube: vira o mesmo resultado do yt-dlp, com a capa que existe', () => {
  assert.deepEqual(resultadosDoInnertube(respostaInnertube), [
    {
      url: 'https://www.youtube.com/watch?v=b7d6wnaRm2E',
      titulo: 'Baby',
      canal: 'Gal Costa',
      duracaoSeg: 213,
      capa: 'https://i.ytimg.com/vi/b7d6wnaRm2E/hq720.jpg',
    },
    {
      url: 'https://www.youtube.com/watch?v=Sc1hkI4jVU8',
      titulo: 'Baby ao vivo',
      canal: 'Brasilidades',
      duracaoSeg: 233,
      capa: 'https://i.ytimg.com/vi/Sc1hkI4jVU8/mqdefault.jpg',
    },
  ]);
  assert.equal(resultadosDoInnertube(respostaInnertube, 1).length, 1);
  assert.deepEqual(resultadosDoInnertube({ qualquer: 'coisa' }), []);
});

test('InnerTube: canais com foto e inscritos; o espelho "- Tema" sai', () => {
  const canal = (channelId, nome, contagem) => ({
    channelRenderer: {
      channelId,
      title: { simpleText: nome },
      videoCountText: { simpleText: contagem },
      thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/foto' }] },
    },
  });
  const artistas = canaisDoInnertube([
    canal('UCfgJsv_g8HEsBZ2c3onYPxg', 'Alceu Valença', '2,41 mi de inscritos'),
    canal('UC785M9D8B5H5CdUDuJHy8Ig', 'Alceu Valença - Tema', undefined),
    canal('UCZA-32pESdvrVjuKXWpKemw', 'Gal Costa', '751 mil inscritos'),
    canal('UC8tInndwxutMOg7ylb67ePA', 'MC do Bairro', '1.234 inscritos'),
  ]);
  assert.deepEqual(
    artistas.map((a) => [a.nome, a.inscritos, a.foto]),
    [
      ['Alceu Valença', 2410000, 'https://yt3.ggpht.com/foto'],
      ['Gal Costa', 751000, 'https://yt3.ggpht.com/foto'],
      ['MC do Bairro', 1234, 'https://yt3.ggpht.com/foto'],
    ],
  );
});

test('a busca responde pela InnerTube sem abrir o yt-dlp', async () => {
  let rodou = false;
  const busca = criarBuscaYoutube({
    rodar: async () => {
      rodou = true;
      return '{"entries":[]}';
    },
    perguntarInnertube: async () => respostaInnertube,
  });
  assert.equal((await busca.buscar('gal costa baby', 'u1')).length, 2);
  assert.equal(rodou, false);
});

test('InnerTube que falha ou vem vazia cai no yt-dlp, e a busca não fica sem resposta', async () => {
  const umVideo = JSON.stringify({
    entries: [{ id: 'b7d6wnaRm2E', title: 'Baby', channel: 'Gal Costa', duration: 213 }],
  });
  for (const perguntarInnertube of [
    async () => {
      throw new Error('recusou a versão do cliente');
    },
    async () => ({}),
  ]) {
    const busca = criarBuscaYoutube({ rodar: async () => umVideo, perguntarInnertube });
    const [faixa] = await busca.buscar('gal costa baby', 'u1');
    assert.equal(faixa.titulo, 'Baby');
  }
});

test('sem vaga, a busca espera a vez em vez de ser recusada', async () => {
  const soltar = [];
  let chamadas = 0;
  const busca = criarBuscaYoutube({
    rodar: () => {
      chamadas += 1;
      return new Promise((resolve) => soltar.push(() => resolve(JSON.stringify({ entries: [] }))));
    },
  });
  const ocupadas = ['a', 'b', 'c'].map((t) => busca.buscar(t, `u-${t}`));
  const quarta = busca.buscar('d', 'u-d');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(chamadas, 3); // a quarta está na fila, não recusada
  soltar.shift()();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(chamadas, 4);
  soltar.forEach((f) => f());
  assert.deepEqual(await quarta, []);
  await Promise.all(ocupadas);
});

test('vaga que não abre a tempo vira limite, e a fila anda depois', async () => {
  const soltar = [];
  const busca = criarBuscaYoutube({
    esperaPorVagaMs: 20,
    rodar: () =>
      new Promise((resolve) => soltar.push(() => resolve(JSON.stringify({ entries: [] })))),
  });
  const ocupadas = ['a', 'b', 'c'].map((t) => busca.buscar(t, `u-${t}`));
  await assert.rejects(busca.buscar('d', 'u-d'), (e) => e.esperarSeg === 3);
  soltar.forEach((f) => f());
  await Promise.all(ocupadas);
  const depois = busca.buscar('e', 'u-e');
  await new Promise((r) => setTimeout(r, 10));
  soltar.at(-1)();
  assert.deepEqual(await depois, []);
});
