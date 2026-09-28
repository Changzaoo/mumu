import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarLimiteDeImport, limparLinkDeImport, pareceAudio } from './seguranca.mjs';

const ok = (bruto) => {
  const r = limparLinkDeImport(bruto);
  assert.equal(r.ok, true, `deveria aceitar ${bruto}: ${r.motivo}`);
  return r;
};
const nao = (bruto) =>
  assert.equal(limparLinkDeImport(bruto).ok, false, `deveria recusar ${bruto}`);

test('YouTube: vira o link canônico, sem nada além do id', () => {
  assert.equal(
    ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(
    ok('https://youtu.be/dQw4w9WgXcQ?si=abc').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(
    ok('https://m.youtube.com/shorts/dQw4w9WgXcQ').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(
    ok('https://music.youtube.com/watch?v=dQw4w9WgXcQ').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  const lista = ok('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  assert.equal(lista.tipo, 'playlist');
  assert.equal(
    lista.url,
    'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
  );
  // vídeo dentro de lista: a lista fica (a pessoa pode pedir a lista inteira)
  assert.match(
    ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').url,
    /&list=PL/,
  );
  // mix automático não é lista de verdade
  assert.equal(
    ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ').url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
});

test('YouTube: redirect, canal e id estranho são recusados (SSRF / não é música)', () => {
  nao('https://www.youtube.com/redirect?q=http://192.168.0.1/admin');
  nao('https://www.youtube.com/attribution_link?u=/watch%3Fv%3DdQw4w9WgXcQ');
  nao('https://www.youtube.com/@matue/community');
  nao('https://www.youtube.com/channel/UCnaoEumIdValido');
  nao('https://www.youtube.com/watch?v=../../etc');
  nao('https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ');
});

test('estrutura do link: usuário, porta, IP, protocolo, espaços, tamanho', () => {
  nao('https://user:senha@www.youtube.com/watch?v=dQw4w9WgXcQ');
  nao('https://www.youtube.com:8080/watch?v=dQw4w9WgXcQ');
  nao('http://127.0.0.1:8790/cofre/estado');
  nao('http://192.168.0.100/');
  nao('http://[::1]/');
  nao('file:///C:/Windows/win.ini');
  nao('ftp://youtube.com/x');
  nao('-o /tmp/x https://youtu.be/dQw4w9WgXcQ');
  nao('https://youtu.be/dQw4w9WgXcQ\nhttp://evil');
  nao(`https://youtu.be/dQw4w9WgXcQ?x=${'a'.repeat(3000)}`);
  nao('https://evilyoutube.com/watch?v=dQw4w9WgXcQ');
  nao('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ');
  nao(42);
});

test('SoundCloud, Vimeo e Bandcamp: só faixa/lista', () => {
  assert.equal(
    ok('https://soundcloud.com/artista/musica?in=x').url,
    'https://soundcloud.com/artista/musica',
  );
  assert.equal(ok('https://soundcloud.com/artista/sets/album').tipo, 'playlist');
  nao('https://soundcloud.com/artista');
  assert.equal(ok('https://vimeo.com/123456').url, 'https://vimeo.com/123456');
  nao('https://vimeo.com/channels/staffpicks');
  assert.equal(
    ok('https://banda.bandcamp.com/track/faixa').url,
    'https://banda.bandcamp.com/track/faixa',
  );
  assert.equal(ok('https://banda.bandcamp.com/album/disco').tipo, 'playlist');
  nao('https://bandcamp.com/discover');
  nao('https://spotify.com/track/abc');
});

test('o arquivo baixado tem que ser áudio', () => {
  assert.equal(
    pareceAudio(Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000', 'latin1')),
    true,
  );
  assert.equal(pareceAudio(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(pareceAudio(Buffer.from('<!DOCTYPE html><html>', 'latin1')), false);
  assert.equal(
    pareceAudio(
      Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000', 'latin1'),
    ),
    false,
  );
});

test('limite por conta: por hora e simultâneos', () => {
  let t = 0;
  const lim = criarLimiteDeImport({
    maxPorJanela: 3,
    janelaMs: 1000,
    maxSimultaneos: 2,
    agora: () => t,
  });
  assert.equal(lim.podeComecar('a').ok, true);
  assert.equal(lim.podeComecar('a').ok, true);
  assert.equal(lim.podeComecar('a').ok, false); // 2 em andamento
  lim.terminou('a');
  assert.equal(lim.podeComecar('a').ok, true); // 3º da janela
  lim.terminou('a');
  lim.terminou('a');
  assert.equal(lim.podeComecar('a').ok, false); // janela cheia
  assert.equal(lim.podeComecar('b').ok, true); // outra conta não é afetada
  t = 2000;
  assert.equal(lim.podeComecar('a').ok, true); // janela nova
});

test('a URL direta só abre CDN de áudio conhecido, nunca a rede de casa', async () => {
  const { ehUrlDiretaSegura } = await import('./seguranca.mjs');
  assert.equal(ehUrlDiretaSegura('https://rr3---sn-abc.googlevideo.com/videoplayback?x=1'), true);
  assert.equal(ehUrlDiretaSegura('https://cf-media.sndcdn.com/abc.mp3'), true);
  assert.equal(ehUrlDiretaSegura('https://192.168.0.100/x'), false);
  assert.equal(ehUrlDiretaSegura('http://rr3.googlevideo.com/x'), false);
  assert.equal(ehUrlDiretaSegura('https://googlevideo.com.evil.net/x'), false);
  assert.equal(ehUrlDiretaSegura('https://localhost/x'), false);
});

test('canal do YouTube vira a aba de vídeos (e é marcado como canal)', () => {
  const a = limparLinkDeImport('https://www.youtube.com/@30praum');
  assert.equal(a.ok, true);
  assert.equal(a.url, 'https://www.youtube.com/@30praum/videos');
  assert.equal(a.canal, true);
  assert.equal(limparLinkDeImport('https://m.youtube.com/@30praum/featured?x=1').url, 'https://www.youtube.com/@30praum/videos');
  assert.equal(
    limparLinkDeImport('https://www.youtube.com/channel/UCoHV8LxUFKeIvifJsB3c7Ww/videos').url,
    'https://www.youtube.com/channel/UCoHV8LxUFKeIvifJsB3c7Ww/videos',
  );
  assert.equal(limparLinkDeImport('https://www.youtube.com/c/Fulano').url, 'https://www.youtube.com/c/Fulano/videos');
});
