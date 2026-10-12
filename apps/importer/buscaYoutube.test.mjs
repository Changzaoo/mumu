import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarBuscaYoutube, parseCanais, parseResultados } from './buscaYoutube.mjs';

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
