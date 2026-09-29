/**
 * LINKS DE SERVIÇO DE MÚSICA (Spotify, Apple Music, Deezer, Tidal) — só para
 * IDENTIFICAR a música. O áudio NUNCA sai desses serviços (é DRM, e baixar de
 * lá não é o que este importador faz): o link vira nome + artista + duração, e
 * o áudio vem pelo caminho de sempre, o YouTube, depois do portão de
 * seguranca.mjs.
 *
 * Aqui mora a parte PURA (sem rede): reconhecer o link, ler as respostas dos
 * serviços e escolher o vídeo certo entre os resultados da busca. A rede fica
 * em resolverDeMusica.mjs.
 *
 * O link colado nunca é buscado como veio: ele vira `{servico, tipo, id}`, e
 * os endereços de metadados são REMONTADOS a partir do id, em hosts fixos.
 */

const TAMANHO_MAX = 2048;
const ID_SPOTIFY = /^[A-Za-z0-9]{22}$/;
const ID_NUMERICO = /^\d{1,15}$/;
const ID_PLAYLIST_APPLE = /^pl\.[A-Za-z0-9-]{8,64}$/;
const ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_CURTO = /^[A-Za-z0-9_-]{4,64}$/;
const TIPOS_SPOTIFY = { track: 'faixa', album: 'album', playlist: 'playlist', artist: 'artista' };

function recusa(motivo) {
  return { ok: false, motivo };
}

/**
 * Link colado → `{ ok, servico, tipo: 'faixa'|'album'|'playlist', id, pais? }`
 * ou a recusa. Links curtos (spotify.link, deezer.page.link) voltam com
 * `curto: true` e `url` remontada: eles SÓ podem ser abertos pelo song.link —
 * seguir o redirecionamento daqui levaria o importador para onde o link quiser.
 */
export function analisarLinkDeMusica(bruto) {
  if (typeof bruto !== 'string') return recusa('link inválido');
  const texto = bruto.trim();
  if (!texto || texto.length > TAMANHO_MAX) return recusa('link inválido');
  // Caractere de controle no meio: não é link (mesma regra de seguranca.mjs).
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(texto)) return recusa('link inválido');
  let u;
  try {
    u = new URL(texto);
  } catch {
    return recusa('link inválido');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return recusa('só links http(s)');
  if (u.username || u.password) return recusa('link com usuário/senha');
  if (u.port && u.port !== '443' && u.port !== '80') return recusa('link com porta');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const partes = u.pathname.split('/').filter(Boolean);

  // ── Spotify: open.spotify.com/(intl-xx/)(embed/)track|album|playlist/<id> ──
  if (host === 'open.spotify.com') {
    let p = partes;
    if (p[0] && /^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(p[0])) p = p.slice(1);
    if (p[0] === 'embed') p = p.slice(1);
    const tipo = TIPOS_SPOTIFY[p[0]];
    if (!tipo || p.length !== 2 || !ID_SPOTIFY.test(p[1])) {
      return recusa('link do Spotify que não é música, álbum nem playlist');
    }
    return { ok: true, servico: 'spotify', tipo, id: p[1] };
  }
  if (host === 'spotify.link') {
    if (partes.length !== 1 || !CODIGO_CURTO.test(partes[0])) return recusa('link curto inválido');
    return {
      ok: true,
      servico: 'spotify',
      tipo: 'faixa',
      id: partes[0],
      curto: true,
      url: `https://spotify.link/${partes[0]}`,
    };
  }

  // ── Deezer: www.deezer.com/(xx/)track|album|playlist/<id> ─────────────
  if (host === 'www.deezer.com' || host === 'deezer.com') {
    let p = partes;
    if (p[0] && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(p[0])) p = p.slice(1);
    const tipo = { track: 'faixa', album: 'album', playlist: 'playlist', artist: 'artista' }[p[0]];
    if (!tipo || p.length !== 2 || !ID_NUMERICO.test(p[1])) {
      return recusa('link do Deezer que não é música, álbum, playlist nem artista');
    }
    return { ok: true, servico: 'deezer', tipo, id: p[1] };
  }
  if (host === 'deezer.page.link' || host === 'link.deezer.com') {
    // link.deezer.com/s/<código>; deezer.page.link/<código>
    const codigo = host === 'link.deezer.com' && partes[0] === 's' ? partes[1] : partes[0];
    const esperado = host === 'link.deezer.com' ? 2 : 1;
    if (partes.length !== esperado || !codigo || !CODIGO_CURTO.test(codigo)) {
      return recusa('link curto inválido');
    }
    return {
      ok: true,
      servico: 'deezer',
      tipo: 'faixa',
      id: codigo,
      curto: true,
      url:
        host === 'link.deezer.com'
          ? `https://link.deezer.com/s/${codigo}`
          : `https://deezer.page.link/${codigo}`,
    };
  }

  // ── Apple Music: music.apple.com/<país>/album|song|playlist/<slug>/<id> ──
  if (host === 'music.apple.com') {
    let p = partes;
    let pais = 'BR';
    if (p[0] && /^[a-z]{2}$/i.test(p[0])) {
      pais = p[0].toUpperCase();
      p = p.slice(1);
    }
    const tipoBruto = p[0];
    const id = p[p.length - 1];
    if (p.length < 2 || p.length > 3) return recusa('link do Apple Music inválido');
    if (tipoBruto === 'album' && ID_NUMERICO.test(id)) {
      const faixa = u.searchParams.get('i');
      if (faixa !== null) {
        if (!ID_NUMERICO.test(faixa)) return recusa('link do Apple Music inválido');
        return { ok: true, servico: 'apple', tipo: 'faixa', id: faixa, pais };
      }
      return { ok: true, servico: 'apple', tipo: 'album', id, pais };
    }
    if (tipoBruto === 'song' && ID_NUMERICO.test(id)) {
      return { ok: true, servico: 'apple', tipo: 'faixa', id, pais };
    }
    if (tipoBruto === 'playlist' && ID_PLAYLIST_APPLE.test(id)) {
      return { ok: true, servico: 'apple', tipo: 'playlist', id, pais };
    }
    return recusa('link do Apple Music que não é música, álbum nem playlist');
  }

  // ── Tidal: tidal.com/(browse/)track|album|playlist/<id>, listen.tidal.com ──
  if (host === 'tidal.com' || host === 'www.tidal.com' || host === 'listen.tidal.com') {
    let p = partes;
    if (p[0] === 'browse') p = p.slice(1);
    // tidal.com/browse/track/123/u — o "/u" é do botão compartilhar.
    if (p.length === 3 && p[2] === 'u') p = p.slice(0, 2);
    const tipo = { track: 'faixa', album: 'album', playlist: 'playlist' }[p[0]];
    const idOk = tipo === 'playlist' ? ID_UUID.test(p[1] ?? '') : ID_NUMERICO.test(p[1] ?? '');
    if (!tipo || p.length !== 2 || !idOk) {
      return recusa('link do Tidal que não é música, álbum nem playlist');
    }
    return { ok: true, servico: 'tidal', tipo, id: p[1] };
  }

  return recusa('não é link de serviço de música');
}

/** Link de volta ao serviço (canônico, remontado do id) — chave de cache e song.link. */
export function linkCanonicoDoServico(l) {
  if (l.curto) return l.url;
  const tipoEn = { faixa: 'track', album: 'album', playlist: 'playlist', artista: 'artist' }[
    l.tipo
  ];
  switch (l.servico) {
    case 'spotify':
      return `https://open.spotify.com/${tipoEn}/${l.id}`;
    case 'deezer':
      return `https://www.deezer.com/${tipoEn}/${l.id}`;
    case 'tidal':
      return `https://tidal.com/browse/${tipoEn}/${l.id}`;
    case 'apple': {
      const pais = (l.pais ?? 'BR').toLowerCase();
      if (l.tipo === 'faixa') return `https://music.apple.com/${pais}/song/${l.id}`;
      return `https://music.apple.com/${pais}/${tipoEn}/${l.id}`;
    }
    default:
      return '';
  }
}

// ── Leitura das respostas dos serviços (formatos conferidos ao vivo) ─────

/** O JSON `__NEXT_DATA__` que a página de embed do Spotify traz embutido. */
export function extrairNextData(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function maiorImagem(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const ordenada = [...lista].sort(
    (a, b) => (b?.maxWidth ?? b?.width ?? 0) - (a?.maxWidth ?? a?.width ?? 0),
  );
  const url = ordenada[0]?.url;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Monta a faixa no formato comum, ou null se faltar o essencial. */
function faixa({ titulo, artistas, duracaoMs, album, capa, link }) {
  const t = texto(titulo);
  const a = (artistas ?? []).map(texto).filter(Boolean);
  if (!t || a.length === 0) return null;
  const d = Number(duracaoMs);
  return {
    titulo: t,
    artistas: a,
    duracaoMs: Number.isFinite(d) && d > 0 ? Math.round(d) : null,
    album: texto(album) || null,
    capa: capa || null,
    ...(link ? { link } : {}),
  };
}

/** Embed de FAIXA do Spotify → faixa. */
export function faixaDoSpotify(html) {
  const e = extrairNextData(html)?.props?.pageProps?.state?.data?.entity;
  if (!e || e.type !== 'track') return null;
  return faixa({
    titulo: e.name ?? e.title,
    artistas: Array.isArray(e.artists) ? e.artists.map((a) => a?.name) : [],
    duracaoMs: e.duration,
    album: null, // o embed de faixa não traz o álbum
    capa: maiorImagem(e.visualIdentity?.image),
  });
}

/**
 * Embed de ÁLBUM/PLAYLIST do Spotify → `{ titulo, faixas }`. Cada item da
 * `trackList` traz `uri` (spotify:track:<id>), título, `subtitle` com os
 * artistas separados por vírgula e a duração em ms.
 */
export function listaDoSpotify(html) {
  const e = extrairNextData(html)?.props?.pageProps?.state?.data?.entity;
  if (!e || !['album', 'playlist', 'artist'].includes(e.type)) return null;
  // Artista: o embed traz o NOME e as mais tocadas; sem lista, ainda vale o
  // nome — é por ele que o Deezer completa (ver `listar`).
  if (!Array.isArray(e.trackList)) {
    return e.type === 'artist' && texto(e.name) ? { titulo: texto(e.name), faixas: [] } : null;
  }
  const capaDaLista = maiorImagem(e.visualIdentity?.image);
  const faixas = [];
  for (const t of e.trackList) {
    const id = String(t?.uri ?? '').match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
    if (!id) continue; // episódio de podcast, faixa local: não é música do catálogo
    const f = faixa({
      titulo: t.title,
      artistas: texto(t.subtitle).split(/\s*,\s*/),
      duracaoMs: t.duration,
      album: e.type === 'album' ? e.name : null,
      capa: e.type === 'album' ? capaDaLista : null,
      link: `https://open.spotify.com/track/${id}`,
    });
    if (f) faixas.push(f);
  }
  return { titulo: texto(e.name) || 'Playlist', faixas };
}

function faixaDeItemDoDeezer(t, albumPadrao) {
  if (!t || typeof t !== 'object' || !ID_NUMERICO.test(String(t.id ?? ''))) return null;
  const album = t.album ?? albumPadrao ?? {};
  return faixa({
    titulo: t.title,
    artistas: [t.artist?.name],
    duracaoMs: Number(t.duration) * 1000,
    album: album.title,
    capa: album.cover_xl || album.cover_big || null,
    link: `https://www.deezer.com/track/${t.id}`,
  });
}

/** api.deezer.com/track/<id> → faixa. */
export function faixaDoDeezer(json) {
  if (!json || json.error || json.type !== 'track') return null;
  return faixaDeItemDoDeezer(json);
}

/** api.deezer.com/album/<id> ou /playlist/<id> → `{ titulo, faixas, total }`. */
export function listaDoDeezer(json) {
  if (!json || json.error || (json.type !== 'album' && json.type !== 'playlist')) return null;
  const itens = Array.isArray(json.tracks?.data) ? json.tracks.data : [];
  const albumPadrao = json.type === 'album' ? json : null;
  const faixas = itens.map((t) => faixaDeItemDoDeezer(t, albumPadrao)).filter(Boolean);
  const total = Number(json.nb_tracks);
  return {
    titulo: texto(json.title) || 'Playlist',
    faixas,
    total: Number.isFinite(total) ? total : faixas.length,
  };
}

/** Continuação paginada do Deezer (`/tracks?index=`) → faixas. */
export function faixasDaPaginaDoDeezer(json, albumPadrao = null) {
  const itens = Array.isArray(json?.data) ? json.data : [];
  return itens.map((t) => faixaDeItemDoDeezer(t, albumPadrao)).filter(Boolean);
}

function capaDoItunes(r) {
  const u = texto(r?.artworkUrl100);
  // A de 100px vem no JSON; o CDN serve qualquer tamanho trocando o sufixo.
  return u.startsWith('https://') ? u.replace(/\/\d+x\d+bb\.jpg$/, '/600x600bb.jpg') : null;
}

function faixaDoItemItunes(r) {
  if (r?.wrapperType !== 'track' || r.kind !== 'song') return null;
  const pais = String(r.country ?? 'BRA')
    .slice(0, 2)
    .toLowerCase();
  return faixa({
    titulo: r.trackName,
    artistas: [r.artistName],
    duracaoMs: r.trackTimeMillis,
    album: r.collectionName,
    capa: capaDoItunes(r),
    link: ID_NUMERICO.test(String(r.trackId))
      ? `https://music.apple.com/${pais}/song/${r.trackId}`
      : undefined,
  });
}

/** itunes.apple.com/lookup?id=<faixa> → faixa. */
export function faixaDoItunes(json) {
  const r = Array.isArray(json?.results) ? json.results.find((x) => x?.kind === 'song') : null;
  return r ? faixaDoItemItunes(r) : null;
}

/** itunes.apple.com/lookup?id=<álbum>&entity=song → `{ titulo, faixas }`. */
export function listaDoItunes(json) {
  const res = Array.isArray(json?.results) ? json.results : [];
  const colecao = res.find((x) => x?.wrapperType === 'collection');
  if (!colecao) return null;
  const faixas = res.map(faixaDoItemItunes).filter(Boolean);
  return { titulo: texto(colecao.collectionName) || 'Álbum', faixas };
}

/**
 * Resposta do song.link → o link do YouTube (ainda cru; quem chama passa pelo
 * portão `limparLinkDeImport`) e os metadados da entidade. null quando não há.
 */
export function youtubeDoSongLink(json) {
  const links = json?.linksByPlatform;
  if (!links || typeof links !== 'object') return null;
  const url = links.youtube?.url || links.youtubeMusic?.url;
  if (typeof url !== 'string') return null;
  const ent = json.entitiesByUniqueId?.[json.entityUniqueId];
  const meta =
    ent && ent.type === 'song'
      ? faixa({
          titulo: ent.title,
          artistas: texto(ent.artistName).split(/\s*,\s*/),
          duracaoMs: null,
          album: null,
          capa: typeof ent.thumbnailUrl === 'string' ? ent.thumbnailUrl : null,
        })
      : null;
  if (ent && ent.type && ent.type !== 'song') return null; // álbum: não é UMA faixa
  return { url, meta };
}

// ── Escolher o vídeo certo (mesma régua de apps/web/.../acharPelaBusca.ts) ──

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');
/** Versões mexidas: nunca são "a mesma música". */
const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|cover|reac(?:t|tion|ting)|reagindo|tutorial|aula)\b/i;
/**
 * Outras gravações da mesma música: só valem se a própria faixa do serviço
 * já for essa versão ("X - Ao Vivo" pede o ao vivo; "X" pede o de estúdio).
 */
const OUTRA_GRAVACAO =
  /\b(?:remix|rmx|ao vivo|live|acustico|acoustic|unplugged|extended|mashup|medley|lyric video with)\b/i;

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat|ft|part|participacao)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normSemAcento(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '');
}

/**
 * O título "de catálogo" sem o sufixo do Spotify/Deezer ("Song - Remastered
 * 2011", "Song - Ao Vivo"): o vídeo quase nunca repete o sufixo igual.
 */
export function tituloBase(titulo) {
  return String(titulo ?? '').replace(/\s+-\s+.*$/, '');
}

/** Nota do resultado da busca para esta faixa; 0 = não é ela. */
export function notaDoResultado(f, r) {
  const titulo = norm(tituloBase(f.titulo));
  if (!titulo) return 0;
  const doVideo = norm(r.titulo);
  if (!doVideo.includes(titulo)) return 0;
  const bruto = normSemAcento(`${r.titulo} ${r.canal ?? ''}`);
  const original = normSemAcento(f.titulo);
  if (VERSAO_ALTERADA.test(bruto) && !VERSAO_ALTERADA.test(original)) return 0;
  if (OUTRA_GRAVACAO.test(normSemAcento(r.titulo)) && !OUTRA_GRAVACAO.test(original)) return 0;
  const onde = `${doVideo} ${norm(r.canal)}`;
  const artistaBate = f.artistas.some((a) => {
    const n = norm(a);
    return n.length >= 2 && onde.includes(n);
  });
  const esperado = (f.duracaoMs ?? 0) / 1000;
  const temDuracao = esperado > 0 && r.duracaoSeg > 0;
  const diferenca = temDuracao ? Math.abs(r.duracaoSeg - esperado) : 0;
  // Muito mais longo/curto que a faixa: é álbum inteiro, versão estendida ou trecho.
  if (temDuracao && diferenca > Math.max(60, esperado * 0.4)) return 0;
  const duracaoBate = temDuracao && diferenca <= Math.max(8, esperado * 0.1);
  if (!artistaBate && !duracaoBate) return 0;
  // Título exato vale mais que título contido ("Mantém" vs "Mantém Remix").
  return (artistaBate ? 2 : 0) + (duracaoBate ? 2 : 0) + (doVideo === titulo ? 1 : 0);
}

/** O melhor resultado (empate: o primeiro, que é a ordem de relevância do YouTube). */
export function melhorResultado(f, resultados) {
  let melhor = null;
  let nota = 0;
  for (const r of resultados ?? []) {
    const n = notaDoResultado(f, r);
    if (n > nota) {
      melhor = r;
      nota = n;
    }
  }
  return melhor;
}

/** O que se digita na busca do YouTube para achar esta faixa. */
export function termoDeBusca(f) {
  return `${f.artistas[0] ?? ''} ${tituloBase(f.titulo)}`.replace(/\s+/g, ' ').trim();
}
