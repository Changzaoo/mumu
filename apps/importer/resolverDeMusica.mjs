/**
 * DE LINK DE SERVIÇO PARA VÍDEO DO YOUTUBE — a parte com rede.
 *
 * O link do Spotify/Apple/Deezer/Tidal só diz QUAL música é; o áudio vem do
 * YouTube, pelo mesmo portão de sempre (seguranca.mjs). Dois caminhos:
 *   a) song.link: o próprio serviço já cruzou os catálogos e devolve o vídeo.
 *      Desde 2026 a API pública responde 401 PUBLIC_API_ACCESS_DEPRECATED —
 *      só funciona com chave (`SONGLINK_API_KEY`). Sem chave ou sem vídeo,
 *   b) metadados do próprio serviço (embed do Spotify, API do Deezer, busca do
 *      iTunes) → busca no YouTube → escolha ESTRITA (linkDeMusica.mjs).
 * Não achou com segurança → erro relatado. Nunca um palpite: tocar outra
 * música no lugar é pior do que dizer que não achou.
 *
 * REDE SÓ PARA HOSTS FIXOS (`HOSTS_DE_METADADOS`), com endereço remontado a
 * partir do id, sem seguir redirecionamento e com teto de tamanho — o link
 * colado nunca é aberto como veio.
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { limparLinkDeImport } from './seguranca.mjs';
import {
  analisarLinkDeMusica,
  linkCanonicoDoServico,
  faixaDoSpotify,
  listaDoSpotify,
  faixaDoDeezer,
  listaDoDeezer,
  faixasDaPaginaDoDeezer,
  faixaDoItunes,
  listaDoItunes,
  youtubeDoSongLink,
  melhorResultado,
  termoDeBusca,
} from './linkDeMusica.mjs';

export const HOSTS_DE_METADADOS = new Set([
  'api.song.link',
  'open.spotify.com',
  'api.deezer.com',
  'itunes.apple.com',
]);

const TIMEOUT_MS = 12_000;
const TAMANHO_MAX_RESPOSTA = 4_000_000;
const CACHE_TTL_MS = 30 * 24 * 3600_000;
const CACHE_MAX = 5000;
/** song.link sem chave: 10 por minuto. Com chave a folga é maior, mas não infinita. */
const SONGLINK_POR_MINUTO = 10;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/** Erro que é da MÚSICA (não adianta repetir), não da rede. */
export class NaoAchei extends Error {}

/**
 * GET só para a lista fixa de hosts. `redirect: 'error'`: um 30x para fora da
 * lista não é seguido (e nem para dentro — os endereços montados aqui não
 * redirecionam).
 */
export async function buscarNaLista(url, { fetch: f = fetch, json = true } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS_DE_METADADOS.has(u.hostname)) {
    throw new Error(`host fora da lista: ${u.hostname}`);
  }
  const res = await f(u.toString(), {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' },
  });
  const corpo = await res.text();
  if (corpo.length > TAMANHO_MAX_RESPOSTA) throw new Error('resposta grande demais');
  return { status: res.status, headers: res.headers, corpo };
}

function comoJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {(termo: string, quem: string) => Promise<Array>} o.buscar busca no YouTube (buscaYoutube.mjs)
 * @param {typeof fetch} [o.fetch]
 * @param {string} [o.chaveSongLink]
 * @param {string|null} [o.arquivoCache] json no disco (fora do git); null = só memória
 * @param {number} [o.maxLista] teto de faixas por álbum/playlist
 */
export function criarResolvedorDeMusica({
  buscar,
  fetch: f = fetch,
  chaveSongLink = '',
  arquivoCache = null,
  maxLista = 300,
  agora = () => Date.now(),
  log = () => {},
} = {}) {
  /** chave `servico:tipo:id` → { em, url, meta } */
  const cache = new Map();
  let cacheCarregado = !arquivoCache;
  let gravacao = null;
  /** Metadados vistos ao listar um álbum/playlist: a faixa não refaz o pedido. */
  const metaVista = new Map();
  const songLinkUsos = [];
  let songLinkParadoAte = 0;

  async function carregarCache() {
    if (cacheCarregado) return;
    cacheCarregado = true;
    try {
      const dados = JSON.parse(await readFile(arquivoCache, 'utf8'));
      const t = agora();
      for (const [k, v] of Object.entries(dados ?? {})) {
        if (v && typeof v.url === 'string' && t - v.em < CACHE_TTL_MS) cache.set(k, v);
      }
    } catch {
      /* primeira vez, ou arquivo estragado: começa vazio */
    }
  }

  function gravarCache() {
    if (!arquivoCache || gravacao) return;
    // Junta as gravações de uma playlist inteira numa só, 2 s depois.
    gravacao = setTimeout(async () => {
      gravacao = null;
      try {
        const tmp = `${arquivoCache}.tmp`;
        await writeFile(tmp, JSON.stringify(Object.fromEntries(cache)));
        await rename(tmp, arquivoCache);
      } catch (e) {
        log('cache de links de música não gravou:', e instanceof Error ? e.message : e);
      }
    }, 2000);
    gravacao.unref?.();
  }

  function guardar(chave, valor) {
    cache.delete(chave);
    cache.set(chave, { ...valor, em: agora() });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    gravarCache();
  }

  /** Portão: só vídeo do YouTube, canônico, faixa. */
  function youtubeCanonico(bruto) {
    const r = limparLinkDeImport(bruto);
    if (!r.ok || r.site !== 'youtube' || r.tipo !== 'faixa') return null;
    // Sem a lista de carona: é UMA música.
    return r.url.replace(/&list=.*$/, '');
  }

  function songLinkPode() {
    const t = agora();
    if (t < songLinkParadoAte) return false;
    while (songLinkUsos.length && t - songLinkUsos[0] > 60_000) songLinkUsos.shift();
    if (songLinkUsos.length >= SONGLINK_POR_MINUTO) return false;
    songLinkUsos.push(t);
    return true;
  }

  /** a) song.link → `{ url, meta }` ou null (e nunca lança: é só o atalho). */
  async function viaSongLink(link) {
    if (!songLinkPode()) return null;
    const alvo = linkCanonicoDoServico(link);
    const q = new URLSearchParams({ url: alvo, userCountry: 'BR' });
    if (chaveSongLink) q.set('key', chaveSongLink);
    try {
      const r = await buscarNaLista(`https://api.song.link/v1-alpha.1/links?${q}`, { fetch: f });
      if (r.status === 429) {
        const seg = Number(r.headers?.get?.('retry-after')) || 60;
        songLinkParadoAte = agora() + seg * 1000;
        log('song.link: 429, pausa de', seg, 's');
        return null;
      }
      if (r.status === 401 || r.status === 403) {
        // API pública desligada (ou chave errada): não insiste por 6 h.
        songLinkParadoAte = agora() + 6 * 3600_000;
        log('song.link recusou (', r.status, ') — seguindo pelos metadados');
        return null;
      }
      if (r.status !== 200) return null;
      const achado = youtubeDoSongLink(comoJson(r.corpo));
      const url = achado ? youtubeCanonico(achado.url) : null;
      return url ? { url, meta: achado.meta } : null;
    } catch {
      return null;
    }
  }

  /** b) Metadados de UMA faixa no próprio serviço. */
  async function metadadosDaFaixa(link) {
    const chave = `${link.servico}:${link.id}`;
    if (metaVista.has(chave)) return metaVista.get(chave);
    let meta = null;
    if (link.servico === 'spotify') {
      const r = await buscarNaLista(`https://open.spotify.com/embed/track/${link.id}`, {
        fetch: f,
        json: false,
      });
      if (r.status === 200) meta = faixaDoSpotify(r.corpo);
      else if (r.status === 404) throw new NaoAchei('Essa música não existe (mais) no Spotify.');
    } else if (link.servico === 'deezer') {
      const r = await buscarNaLista(`https://api.deezer.com/track/${link.id}`, { fetch: f });
      meta = r.status === 200 ? faixaDoDeezer(comoJson(r.corpo)) : null;
    } else if (link.servico === 'apple') {
      const pais = encodeURIComponent(link.pais ?? 'BR');
      const r = await buscarNaLista(
        `https://itunes.apple.com/lookup?id=${link.id}&country=${pais}`,
        { fetch: f },
      );
      meta = r.status === 200 ? faixaDoItunes(comoJson(r.corpo)) : null;
    }
    return meta;
  }

  /** Metadados + busca no YouTube + escolha estrita → url canônica ou erro. */
  async function viaBusca(link, quem, metaConhecida) {
    const meta = metaConhecida ?? (await metadadosDaFaixa(link));
    if (!meta) {
      if (link.servico === 'tidal') {
        throw new NaoAchei(
          'Link do Tidal ainda não dá para importar. Cole o do Spotify ou YouTube.',
        );
      }
      throw new NaoAchei('Não consegui ler essa música no serviço.');
    }
    const resultados = await buscar(termoDeBusca(meta), `musica:${quem ?? 'servico'}`);
    const achado = melhorResultado(meta, resultados);
    const url = achado ? youtubeCanonico(achado.url) : null;
    if (!url) {
      throw new NaoAchei(`Não achei "${meta.titulo}" no YouTube com segurança.`);
    }
    return { url, meta };
  }

  /**
   * Link de FAIXA → `{ url (YouTube canônico), meta }`. Lança `NaoAchei` quando
   * a música não tem par seguro; outros erros (rede, limite) são transitórios.
   */
  async function resolverFaixa(bruto, quem = null) {
    const link = typeof bruto === 'string' ? analisarLinkDeMusica(bruto) : bruto;
    if (!link?.ok || link.tipo !== 'faixa') throw new NaoAchei('Link de música inválido.');
    await carregarCache();
    const chave = `${link.servico}:faixa:${link.id}`;
    const guardado = cache.get(chave);
    if (guardado && agora() - guardado.em < CACHE_TTL_MS) {
      return { url: guardado.url, meta: guardado.meta };
    }
    let r = await viaSongLink(link);
    // O song.link acerta o vídeo, mas os metadados do serviço são mais limpos
    // (duração, álbum, capa grande): busca-os quando der, sem travar por isso.
    if (r && !link.curto) {
      const meta = await metadadosDaFaixa(link).catch(() => null);
      if (meta) r = { ...r, meta };
    }
    if (!r) {
      if (link.curto) {
        throw new NaoAchei('Link curto: abra no app e cole o endereço completo da música.');
      }
      r = await viaBusca(link, quem);
    }
    guardar(chave, r);
    log('link de música:', chave, '→', r.url);
    return r;
  }

  /**
   * Link de ÁLBUM/PLAYLIST → `{ title, entries: [{ url, title }] }`.
   *
   * As entradas são os links de FAIXA do próprio serviço, não do YouTube:
   * resolver 300 faixas aqui (uma busca no YouTube cada) passaria dos ~100 s
   * que o túnel do Cloudflare deixa uma resposta muda. Cada faixa entra na
   * fila como um import normal, resolve dentro do job (que não tem esse teto)
   * e conta no limite por conta como qualquer outra; a que não tiver par
   * seguro aparece com erro na fila. Os metadados já lidos ficam em memória
   * para o job não pedir de novo.
   */
  /**
   * ARTISTA → TODAS AS MÚSICAS DELE. O embed do Spotify dá o nome e as mais
   * tocadas (umas 10); o Deezer completa com as mais tocadas dele (até 100) e
   * depois com a DISCOGRAFIA (álbuns, EPs e singles), até o teto `maxLista` —
   * quem cola o link do artista quer tudo dele, não um top 10.
   *
   * Falha de rede não é "artista sem música": se nada veio E alguma fonte
   * caiu, o erro é comum (500 → a fila tenta de novo); só a resposta vazia de
   * fontes que responderam vira `NaoAchei` (422 → erro definitivo).
   */
  async function listarArtista(link) {
    let nome = null;
    let fonteCaiu = false;
    // Discografia grande = dezenas de pedidos; a resposta do /playlist precisa
    // sair antes dos ~100 s do túnel do Cloudflare. Estourou o prazo, devolve
    // o que já juntou (as mais tocadas vêm primeiro, então o essencial entra).
    const prazo = agora() + 45_000;
    const pedir = (url, opcoes = {}) =>
      buscarNaLista(url, { fetch: f, ...opcoes }).then(
        (r) => {
          if (r.status >= 500 || r.status === 429) fonteCaiu = true;
          return r;
        },
        () => {
          fonteCaiu = true;
          return null;
        },
      );
    const faixas = [];
    const vistas = new Set();
    const juntar = (lista) => {
      for (const f of lista) {
        if (faixas.length >= maxLista) return;
        const chave = `${f.titulo}`
          .toLowerCase()
          .replace(/\s*[([].*$/, '')
          .trim();
        if (!chave || vistas.has(chave)) continue;
        vistas.add(chave);
        faixas.push(f);
      }
    };
    let idDeezer = link.servico === 'deezer' ? link.id : null;
    if (link.servico === 'spotify') {
      const r = await pedir(`https://open.spotify.com/embed/artist/${link.id}`, { json: false });
      const doSpotify = r?.status === 200 ? listaDoSpotify(r.corpo) : null;
      if (doSpotify) {
        nome = doSpotify.titulo;
        juntar(doSpotify.faixas);
      }
      if (nome) {
        const busca = await pedir(
          `https://api.deezer.com/search/artist?q=${encodeURIComponent(nome)}&limit=5`,
        );
        const achados = busca?.status === 200 ? (comoJson(busca.corpo)?.data ?? []) : [];
        const norm = (t) =>
          String(t ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
        const exato = achados.find((a) => norm(a?.name) === norm(nome));
        idDeezer = String((exato ?? achados[0])?.id ?? '') || null;
      }
    }
    if (idDeezer && /^\d+$/.test(idDeezer)) {
      if (!nome) {
        const a = await pedir(`https://api.deezer.com/artist/${idDeezer}`);
        nome = a?.status === 200 ? (comoJson(a.corpo)?.name ?? null) : null;
      }
      const top = await pedir(
        `https://api.deezer.com/artist/${idDeezer}/top?limit=${Math.min(100, maxLista)}`,
      );
      juntar(faixasDaPaginaDoDeezer(top?.status === 200 ? comoJson(top.corpo) : null));

      // Discografia: todos os lançamentos do artista, página a página.
      // Coletânea ('compile') fica de fora — é disco de vários artistas, e as
      // faixas dele que estão lá já vêm pelos álbuns próprios.
      const albuns = [];
      for (let index = 0; faixas.length < maxLista && agora() < prazo && index < 1000;) {
        const p = await pedir(
          `https://api.deezer.com/artist/${idDeezer}/albums?index=${index}&limit=100`,
        );
        const pagina = p?.status === 200 ? comoJson(p.corpo) : null;
        const itens = Array.isArray(pagina?.data) ? pagina.data : [];
        for (const a of itens) {
          if (/^\d{1,15}$/.test(String(a?.id ?? '')) && a.record_type !== 'compile') albuns.push(a);
        }
        if (itens.length === 0 || !pagina.next) break;
        index += itens.length;
      }
      // 4 álbuns por vez: rápido o bastante para caber no prazo sem martelar
      // a API pública do Deezer (que devolve 429 para rajada).
      for (let i = 0; i < albuns.length && faixas.length < maxLista && agora() < prazo; i += 4) {
        const lote = await Promise.all(
          albuns
            .slice(i, i + 4)
            .map((a) => pedir(`https://api.deezer.com/album/${a.id}/tracks?limit=100`)),
        );
        lote.forEach((r, k) => {
          const json = r?.status === 200 ? comoJson(r.corpo) : null;
          // Só as faixas em que ELE é o artista principal: participação num
          // disco alheio não é "música do artista" que a pessoa pediu.
          const doArtista = Array.isArray(json?.data)
            ? json.data.filter((t) => !t?.artist?.id || String(t.artist.id) === idDeezer)
            : [];
          juntar(faixasDaPaginaDoDeezer({ data: doArtista }, albuns[i + k]));
        });
      }
    }
    if (faixas.length === 0) {
      if (fonteCaiu) throw new Error('Spotify/Deezer não responderam agora. Tente de novo.');
      if (nome) throw new NaoAchei(`Não achei músicas de ${nome}.`);
      return null;
    }
    return { titulo: `${nome ?? 'Artista'} · discografia`, faixas };
  }

  async function listar(bruto) {
    const link = typeof bruto === 'string' ? analisarLinkDeMusica(bruto) : bruto;
    if (!link?.ok || link.tipo === 'faixa') throw new NaoAchei('Link de álbum/playlist inválido.');
    let lista = null;
    if (link.tipo === 'artista') {
      lista = await listarArtista(link);
    } else if (link.servico === 'spotify') {
      const r = await buscarNaLista(
        `https://open.spotify.com/embed/${link.tipo === 'album' ? 'album' : 'playlist'}/${link.id}`,
        { fetch: f, json: false },
      );
      if (r.status === 200) lista = listaDoSpotify(r.corpo);
    } else if (link.servico === 'deezer') {
      const base = `https://api.deezer.com/${link.tipo}/${link.id}`;
      const r = await buscarNaLista(base, { fetch: f });
      const json = r.status === 200 ? comoJson(r.corpo) : null;
      lista = listaDoDeezer(json);
      // Lista longa vem cortada no objeto: o resto, página a página.
      while (lista && lista.faixas.length < Math.min(lista.total, maxLista)) {
        const p = await buscarNaLista(`${base}/tracks?index=${lista.faixas.length}&limit=100`, {
          fetch: f,
        });
        const mais = faixasDaPaginaDoDeezer(
          p.status === 200 ? comoJson(p.corpo) : null,
          link.tipo === 'album' ? json : null,
        );
        if (mais.length === 0) break;
        lista.faixas.push(...mais);
      }
    } else if (link.servico === 'apple') {
      if (link.tipo === 'playlist') {
        throw new NaoAchei('Playlist do Apple Music ainda não dá para importar. Cole um álbum.');
      }
      const pais = encodeURIComponent(link.pais ?? 'BR');
      const r = await buscarNaLista(
        `https://itunes.apple.com/lookup?id=${link.id}&entity=song&limit=${maxLista}&country=${pais}`,
        { fetch: f },
      );
      lista = r.status === 200 ? listaDoItunes(comoJson(r.corpo)) : null;
    } else if (link.servico === 'tidal') {
      throw new NaoAchei('Álbum/playlist do Tidal ainda não dá para importar.');
    }
    if (!lista) throw new NaoAchei('Não consegui ler essa lista (privada ou removida?).');

    const entries = [];
    for (const faixa of lista.faixas.slice(0, maxLista)) {
      const l = analisarLinkDeMusica(faixa.link ?? '');
      if (!l.ok || l.tipo !== 'faixa') continue;
      metaVista.set(`${l.servico}:${l.id}`, faixa);
      entries.push({ url: faixa.link, title: `${faixa.artistas.join(', ')} - ${faixa.titulo}` });
    }
    while (metaVista.size > 20_000) metaVista.delete(metaVista.keys().next().value);
    return { title: lista.titulo, entries };
  }

  return { resolverFaixa, listar, metadadosDaFaixa };
}
