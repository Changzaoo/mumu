// Links de serviço de música: reconhecer o link (e recusar o resto), ler as
// respostas gravadas dos serviços (__fixtures__, capturadas ao vivo) e escolher
// o vídeo certo. Sem rede: `node --test apps/importer/linkDeMusica.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analisarLinkDeMusica,
  linkCanonicoDoServico,
  faixaDoSpotify,
  listaDoSpotify,
  faixaDoDeezer,
  listaDoDeezer,
  faixaDoItunes,
  listaDoItunes,
  youtubeDoSongLink,
  notaDoResultado,
  melhorResultado,
  termoDeBusca,
} from './linkDeMusica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(path.join(AQUI, '__fixtures__', n), 'utf8');
const fxJson = (n) => JSON.parse(fx(n));

function ok(link, servico, tipo, id) {
  const r = analisarLinkDeMusica(link);
  assert.equal(r.ok, true, `${link}: ${r.motivo}`);
  assert.equal(r.servico, servico);
  assert.equal(r.tipo, tipo);
  assert.equal(r.id, id);
  return r;
}

test('Spotify: faixa, álbum, playlist, /intl-xx/, embed e ?si=', () => {
  ok('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', 'spotify', 'faixa', '0VjIjW4GlUZAMYd2vXMi3b');
  ok('https://open.spotify.com/intl-pt/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc', 'spotify', 'faixa', '0VjIjW4GlUZAMYd2vXMi3b');
  ok('https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj', 'spotify', 'album', '4yP0hdKOZPNshxUOjY0cZj');
  ok('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'spotify', 'playlist', '37i9dQZF1DXcBWIGoYBM5M');
  ok('https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b', 'spotify', 'faixa', '0VjIjW4GlUZAMYd2vXMi3b');
  const curto = ok('https://spotify.link/AbCd1234', 'spotify', 'faixa', 'AbCd1234');
  assert.equal(curto.curto, true);
});

test('Deezer, Apple Music e Tidal', () => {
  ok('https://www.deezer.com/track/3135556', 'deezer', 'faixa', '3135556');
  ok('https://www.deezer.com/br/album/302127', 'deezer', 'album', '302127');
  ok('https://deezer.com/en/playlist/908622995', 'deezer', 'playlist', '908622995');
  assert.equal(analisarLinkDeMusica('https://deezer.page.link/xyz123').curto, true);
  const a = ok(
    'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378615',
    'apple',
    'faixa',
    '1499378615',
  );
  assert.equal(a.pais, 'US');
  ok('https://music.apple.com/br/album/after-hours/1499378108', 'apple', 'album', '1499378108');
  ok('https://music.apple.com/br/song/blinding-lights/1499378615', 'apple', 'faixa', '1499378615');
  ok('https://music.apple.com/br/playlist/x/pl.f4d106fed2bd41149aaacabb233eb5eb', 'apple', 'playlist', 'pl.f4d106fed2bd41149aaacabb233eb5eb');
  ok('https://tidal.com/browse/track/77646168/u', 'tidal', 'faixa', '77646168');
  ok('https://listen.tidal.com/album/77646164', 'tidal', 'album', '77646164');
});

test('recusa o que não é link de música, sem abrir nada', () => {
  for (const ruim of [
    'https://open.spotify.com/artist/1Xyo4u8uXC1ZmMpatF05PJ',
    'https://open.spotify.com/track/curto',
    'https://open.spotify.com.evil.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    'https://evil.com/open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    'https://user:x@open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    'https://open.spotify.com:8443/track/0VjIjW4GlUZAMYd2vXMi3b',
    'ftp://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    'https://www.deezer.com/track/abc',
    'https://www.deezer.com/artist/27',
    'https://music.apple.com/br/artist/the-weeknd/479756766',
    'https://tidal.com/browse/playlist/nao-uuid',
    'https://spotify.link/../../etc',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://127.0.0.1/track/0VjIjW4GlUZAMYd2vXMi3b',
    'não é link',
  ]) {
    assert.equal(analisarLinkDeMusica(ruim).ok, false, ruim);
  }
});

test('link canônico remontado a partir do id', () => {
  const l = analisarLinkDeMusica('https://open.spotify.com/intl-pt/track/0VjIjW4GlUZAMYd2vXMi3b?si=x');
  assert.equal(linkCanonicoDoServico(l), 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b');
});

test('embed do Spotify (gravado): faixa, álbum e playlist', () => {
  const f = faixaDoSpotify(fx('sp-track-0VjIjW4GlUZAMYd2vXMi3b.html'));
  assert.equal(f.titulo, 'Blinding Lights');
  assert.deepEqual(f.artistas, ['The Weeknd']);
  assert.equal(f.duracaoMs, 200040);
  assert.match(f.capa, /^https:\/\/image-cdn-ak\.spotifycdn\.com\//);

  const al = listaDoSpotify(fx('sp-album-4yP0hdKOZPNshxUOjY0cZj.html'));
  assert.equal(al.titulo, 'After Hours');
  assert.equal(al.faixas.length, 14);
  assert.equal(al.faixas[0].titulo, 'Alone Again');
  assert.equal(al.faixas[0].album, 'After Hours');
  assert.equal(al.faixas[0].link, 'https://open.spotify.com/track/6b5P51m8xx2XA6U7sdNZ5E');

  const pl = listaDoSpotify(fx('sp-playlist-37i9dQZF1DXcBWIGoYBM5M.html'));
  assert.equal(pl.faixas.length, 50);
  assert.ok(pl.faixas.some((x) => x.artistas.length > 1), 'subtitle com vírgula vira vários artistas');
});

test('Deezer e iTunes (gravados)', () => {
  const d = faixaDoDeezer(fxJson('dz-track-3135556.json'));
  assert.equal(d.titulo, 'Harder, Better, Faster, Stronger');
  assert.deepEqual(d.artistas, ['Daft Punk']);
  assert.equal(d.duracaoMs, 226000);
  assert.equal(d.album, 'Discovery');

  const al = listaDoDeezer(fxJson('dz-album-302127.json'));
  assert.equal(al.titulo, 'Discovery');
  assert.equal(al.faixas.length, 14);
  assert.equal(al.faixas[0].album, 'Discovery');
  const pl = listaDoDeezer(fxJson('dz-playlist-908622995.json'));
  assert.equal(pl.faixas.length, 50);
  assert.equal(pl.faixas[0].link, 'https://www.deezer.com/track/116348632');

  const it = faixaDoItunes(fxJson('it-lookup-1499378615.json'));
  assert.equal(it.titulo, 'After Hours');
  assert.equal(it.duracaoMs, 361025);
  assert.match(it.capa, /600x600bb\.jpg$/);
  const ia = listaDoItunes(fxJson('it-lookup-album-1499378108.json'));
  assert.equal(ia.titulo, 'After Hours');
  assert.equal(ia.faixas.length, 14);
  assert.equal(analisarLinkDeMusica(ia.faixas[0].link).tipo, 'faixa');
});

test('song.link: vídeo do YouTube só de uma MÚSICA; 401 gravado não vira nada', () => {
  assert.equal(youtubeDoSongLink(fxJson('songlink-401-deprecated.json')), null);
  const r = youtubeDoSongLink({
    entityUniqueId: 'S',
    entitiesByUniqueId: { S: { type: 'song', title: 'X', artistName: 'Y' } },
    linksByPlatform: { youtube: { url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ' } },
  });
  assert.equal(r.url, 'https://www.youtube.com/watch?v=4NRXx6U8ABQ');
  const album = youtubeDoSongLink({
    entityUniqueId: 'A',
    entitiesByUniqueId: { A: { type: 'album', title: 'X' } },
    linksByPlatform: { youtube: { url: 'https://www.youtube.com/playlist?list=PLx' } },
  });
  assert.equal(album, null);
});

const blinding = { titulo: 'Blinding Lights', artistas: ['The Weeknd'], duracaoMs: 200040 };
const r = (titulo, canal, duracaoSeg, id = 'aaaaaaaaaaa') => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  titulo,
  canal,
  duracaoSeg,
});

test('escolha estrita: título + (artista ou duração), sem versão mexida', () => {
  assert.ok(notaDoResultado(blinding, r('The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd', 202)) > 0);
  assert.ok(notaDoResultado(blinding, r('Blinding Lights', 'The Weeknd - Topic', 200)) > 0);
  assert.equal(notaDoResultado(blinding, r('Blinding Lights (sped up)', 'The Weeknd', 170)), 0);
  assert.equal(notaDoResultado(blinding, r('Blinding Lights - 8D Audio', 'x', 200)), 0);
  assert.equal(notaDoResultado(blinding, r('Blinding Lights (Karaokê)', 'x', 200)), 0);
  assert.equal(notaDoResultado(blinding, r('The Weeknd - Blinding Lights (Remix)', 'x', 200)), 0);
  assert.equal(notaDoResultado(blinding, r('The Weeknd - Blinding Lights (Live at SNL)', 'x', 200)), 0);
  assert.equal(notaDoResultado(blinding, r('Blinding Lights cover', 'Fulano', 200)), 0);
  // Nem artista nem duração: outra música com o mesmo nome.
  assert.equal(notaDoResultado(blinding, r('Blinding Lights', 'Outra Banda', 260)), 0);
  // Título diferente: não é.
  assert.equal(notaDoResultado(blinding, r('The Weeknd - Save Your Tears', 'The Weeknd', 200)), 0);
  // Álbum inteiro de 1 h com o nome da faixa no título.
  assert.equal(notaDoResultado(blinding, r('The Weeknd Blinding Lights full album', 'The Weeknd', 900)), 0);
});

test('versão que a PRÓPRIA faixa já é passa; sufixo " - Remastered" é ignorado', () => {
  const aoVivo = { titulo: 'Evidências - Ao Vivo', artistas: ['Chitãozinho & Xororó'], duracaoMs: 280000 };
  assert.ok(notaDoResultado(aoVivo, r('Chitãozinho & Xororó - Evidências (Ao Vivo)', 'x', 282)) > 0);
  const remaster = { titulo: 'Hey Jude - Remastered 2015', artistas: ['The Beatles'], duracaoMs: 429000 };
  assert.ok(notaDoResultado(remaster, r('The Beatles - Hey Jude', 'The Beatles', 431)) > 0);
  assert.equal(termoDeBusca(remaster), 'The Beatles Hey Jude');
});

test('melhorResultado: o mais certo, ou nenhum (nunca palpite)', () => {
  const lista = [
    r('Blinding Lights (slowed + reverb)', 'x', 230, 'a1111111111'),
    r('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO', 262, 'b2222222222'),
    r('The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd', 201, 'c3333333333'),
  ];
  assert.equal(melhorResultado(blinding, lista).url, 'https://www.youtube.com/watch?v=c3333333333');
  assert.equal(melhorResultado(blinding, [lista[0]]), null);
  assert.equal(melhorResultado(blinding, []), null);
});
