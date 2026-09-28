/**
 * O PORTÃO DOS LINKS — tudo o que alguém cola no site passa por aqui antes de
 * chegar ao yt-dlp.
 *
 * Qualquer conta pode baixar música, e o yt-dlp roda NESTA máquina, dentro da
 * rede de casa. Um link mal-intencionado não pode virar:
 *   • SSRF: `youtube.com/redirect?q=http://192.168.0.1/…` não é vídeo — o
 *     yt-dlp caía no extrator GENÉRICO, que baixa QUALQUER endereço, inclusive
 *     da rede interna. Por isso o link é RECONSTRUÍDO a partir do id (só
 *     formatos conhecidos de música passam) e o extrator genérico é desligado
 *     em toda chamada (`ARGS_DE_SEGURANCA`);
 *   • injeção de opção: o link vai depois de `--` e nunca começa com `-`;
 *   • abuso: limite por conta (quantidade por hora e downloads simultâneos).
 *
 * Puro e sem estado global (o limitador é uma instância), para testar sem
 * subir o servidor.
 */

/** Links maiores que isto não são link de música. */
const TAMANHO_MAX = 2048;
const ID_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const ID_LISTA = /^[A-Za-z0-9_-]{10,64}$/;
/** Listas automáticas do YouTube (mix "RD…", "Minha Mix") não têm fim útil. */
const LISTA_AUTOMATICA = /^(?:RD|UL|LL|WL)/;
const SEGMENTO = /^[A-Za-z0-9._~%-]{1,200}$/;

/**
 * Argumentos que TODA chamada do yt-dlp leva: sem extrator genérico (o que
 * baixa qualquer URL) e sem ler arquivos de configuração do usuário da máquina.
 */
export const ARGS_DE_SEGURANCA = ['--use-extractors', 'default,-generic', '--ignore-config'];

/** Hostname que é um IP (v4 ou v6) — link de música nunca é. */
function ehIp(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
}

function recusa(motivo) {
  return { ok: false, motivo };
}

/**
 * O caminho de um canal do YouTube → "@nome", "channel/UC…", "c/nome" ou
 * "user/nome" (sem a aba), ou null. Só o que o YouTube usa para canal.
 */
const ABAS_DO_CANAL = new Set(['videos', 'featured', 'music', 'releases']);

function canalDoYoutube(pathname) {
  const partes = pathname.split('/').filter(Boolean);
  // Tira a aba do fim (só as que listam vídeos/música).
  if (partes.length > 1 && ABAS_DO_CANAL.has(partes[partes.length - 1])) partes.pop();
  const [a, b] = partes;
  if (partes.length === 1 && /^@[A-Za-z0-9._-]{3,100}$/.test(a ?? '')) return a;
  if (partes.length !== 2) return null;
  if (a === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(b)) return `channel/${b}`;
  if ((a === 'c' || a === 'user') && /^[A-Za-z0-9._-]{1,100}$/.test(b)) return `${a}/${b}`;
  return null;
}

/**
 * Link colado → link CANÔNICO seguro, ou a recusa com o motivo.
 * `{ ok: true, url, tipo: 'faixa' | 'playlist', site }`.
 */
export function limparLinkDeImport(bruto) {
  if (typeof bruto !== 'string') return recusa('link inválido');
  const texto = bruto.trim();
  if (!texto || texto.length > TAMANHO_MAX) return recusa('link inválido');
  // Espaço, controle ou quebra de linha no meio: não é um link, é outra coisa.
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
  if (ehIp(host)) return recusa('link para endereço IP');
  const semWww = host.replace(/^(?:www|m)\./, '');

  // ── YouTube (inclui YouTube Music e youtu.be) ─────────────────────────
  if (semWww === 'youtube.com' || semWww === 'music.youtube.com' || semWww === 'youtu.be') {
    let video = null;
    const lista = u.searchParams.get('list');
    if (semWww === 'youtu.be') {
      video = u.pathname.slice(1).split('/')[0] ?? '';
    } else if (u.pathname === '/watch') {
      video = u.searchParams.get('v') ?? '';
    } else if (/^\/shorts\/[^/]+\/?$/.test(u.pathname)) {
      video = u.pathname.split('/')[2] ?? '';
    } else if (u.pathname === '/playlist') {
      if (!lista || !ID_LISTA.test(lista) || LISTA_AUTOMATICA.test(lista)) {
        return recusa('playlist inválida');
      }
      return {
        ok: true,
        url: `https://www.youtube.com/playlist?list=${lista}`,
        tipo: 'playlist',
        site: 'youtube',
      };
    } else {
      // CANAL: vira a aba de vídeos, e quem chama passa cada vídeo pelo
      // classificador de "isso é música?" (ehMusica.mjs) — canal de artista
      // mistura clipe com vlog, bastidores e documentário.
      const canal = canalDoYoutube(u.pathname);
      if (canal) {
        return {
          ok: true,
          url: `https://www.youtube.com/${canal}/videos`,
          tipo: 'playlist',
          canal: true,
          site: 'youtube',
        };
      }
      // redirect, attribution_link, embed de outro site…: não é música.
      return recusa('link do YouTube que não é vídeo, playlist nem canal');
    }
    if (!ID_VIDEO.test(video)) return recusa('vídeo inválido');
    const comLista = lista && ID_LISTA.test(lista) && !LISTA_AUTOMATICA.test(lista);
    return {
      ok: true,
      url: `https://www.youtube.com/watch?v=${video}${comLista ? `&list=${lista}` : ''}`,
      tipo: 'faixa',
      site: 'youtube',
    };
  }

  const partes = u.pathname.split('/').filter(Boolean);
  const segmentosOk = partes.every((p) => SEGMENTO.test(p));

  // ── SoundCloud: /artista/faixa ou /artista/sets/lista ─────────────────
  if (semWww === 'soundcloud.com') {
    if (!segmentosOk) return recusa('link do SoundCloud inválido');
    if (partes.length === 2 && partes[1] !== 'sets') {
      return {
        ok: true,
        url: `https://soundcloud.com/${partes.join('/')}`,
        tipo: 'faixa',
        site: 'soundcloud',
      };
    }
    if (partes.length === 3 && partes[1] === 'sets') {
      return {
        ok: true,
        url: `https://soundcloud.com/${partes.join('/')}`,
        tipo: 'playlist',
        site: 'soundcloud',
      };
    }
    return recusa('link do SoundCloud que não é faixa nem set');
  }

  // ── Vimeo: /123456 ─────────────────────────────────────────────────────
  if (semWww === 'vimeo.com') {
    if (partes.length === 1 && /^\d{1,12}$/.test(partes[0])) {
      return { ok: true, url: `https://vimeo.com/${partes[0]}`, tipo: 'faixa', site: 'vimeo' };
    }
    return recusa('link do Vimeo que não é vídeo');
  }

  // ── Bandcamp: artista.bandcamp.com/track/x ou /album/x ─────────────────
  if (semWww.endsWith('.bandcamp.com')) {
    const artista = semWww.slice(0, -'.bandcamp.com'.length);
    if (!/^[a-z0-9-]{1,63}$/.test(artista) || !segmentosOk)
      return recusa('link do Bandcamp inválido');
    if (partes.length === 2 && (partes[0] === 'track' || partes[0] === 'album')) {
      return {
        ok: true,
        url: `https://${artista}.bandcamp.com/${partes[0]}/${partes[1]}`,
        tipo: partes[0] === 'album' ? 'playlist' : 'faixa',
        site: 'bandcamp',
      };
    }
    return recusa('link do Bandcamp que não é faixa nem álbum');
  }

  return recusa('site não suportado');
}

/**
 * O arquivo baixado é mesmo ÁUDIO? Pelos primeiros bytes (o que o conversor
 * gera é MP3; M4A/OGG/WAV/FLAC ficam por garantia) — um HTML de erro ou
 * qualquer outra coisa disfarçada não entra no cofre.
 */
export function pareceAudio(cabeca) {
  if (!cabeca || cabeca.length < 12) return false;
  const b = cabeca;
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (ascii(0, 'ID3')) return true; // MP3 com tag
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true; // quadro MPEG
  if (ascii(4, 'ftyp')) return true; // MP4/M4A
  if (ascii(0, 'OggS') || ascii(0, 'fLaC')) return true;
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return true;
  return false;
}

/**
 * Limite por conta: quantos pedidos numa janela e quantos ao mesmo tempo.
 * `quem` = id da conta (ou IP); o crachá de serviço não passa por aqui.
 */
export function criarLimiteDeImport({
  maxPorJanela = 60,
  janelaMs = 60 * 60_000,
  maxSimultaneos = 3,
  agora = () => Date.now(),
} = {}) {
  const historico = new Map();
  const emCurso = new Map();

  function podeComecar(quem) {
    const t = agora();
    const recentes = (historico.get(quem) ?? []).filter((em) => t - em < janelaMs);
    historico.set(quem, recentes);
    if ((emCurso.get(quem) ?? 0) >= maxSimultaneos) {
      return { ok: false, motivo: 'Espere os downloads em andamento terminarem.', esperarSeg: 20 };
    }
    if (recentes.length >= maxPorJanela) {
      const esperarSeg = Math.max(1, Math.ceil((recentes[0] + janelaMs - t) / 1000));
      return { ok: false, motivo: 'Limite de downloads por hora alcançado.', esperarSeg };
    }
    recentes.push(t);
    emCurso.set(quem, (emCurso.get(quem) ?? 0) + 1);
    if (historico.size > 10_000) {
      for (const [k, v] of historico) if (!v.some((em) => t - em < janelaMs)) historico.delete(k);
    }
    return { ok: true };
  }

  function terminou(quem) {
    const n = (emCurso.get(quem) ?? 0) - 1;
    if (n > 0) emCurso.set(quem, n);
    else emCurso.delete(quem);
  }

  return { podeComecar, terminou };
}

/**
 * CDNs de onde o áudio de verdade sai (a "URL direta" que o yt-dlp resolve).
 * O importador abre essa URL — e segue redirecionamentos — sozinho: fora desta
 * lista (ou para um IP), a via rápida recusa e a faixa cai na via lenta, que
 * baixa pelo yt-dlp já protegido. Nunca a rede de casa.
 */
const CDNS_DE_AUDIO = [
  'googlevideo.com',
  'youtube.com',
  'sndcdn.com',
  'soundcloud.cloud',
  'vimeocdn.com',
  'akamaized.net',
  'bcbits.com',
];

export function ehUrlDiretaSegura(bruto) {
  try {
    const u = new URL(bruto);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (ehIp(host)) return false;
    return CDNS_DE_AUDIO.some((c) => host === c || host.endsWith(`.${c}`));
  } catch {
    return false;
  }
}
