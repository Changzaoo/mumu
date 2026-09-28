/**
 * O QUE A PESSOA COLOU (OU COMPARTILHOU) → UM LINK LIMPO E SEGURO.
 *
 * "Compartilhar" no app do Spotify/YouTube não entrega um link: entrega um
 * TEXTO — "Ouça Tal Música no Spotify: https://open.spotify.com/track/…?si=…".
 * Exigir que a pessoa recorte só o endereço é o tipo de atrito que faz desistir.
 * Aqui o link é achado dentro do texto.
 *
 * E vem sujo: `si`, `utm_*`, `feature=share`, `fbclid`… são identificadores de
 * QUEM compartilhou com QUEM. Não servem para achar a música e não têm por que
 * ficar gravados na fila, no aparelho ou no servidor. Saem antes de tudo.
 *
 * As recusas espelham as do importador (apps/importer/seguranca.mjs) — que
 * continua sendo a barreira de verdade. Aqui é para a resposta ser imediata e
 * para o que o servidor recusaria nem sair do aparelho.
 */

const TAMANHO_MAX = 2048;

/** Parâmetros que só rastreiam — nunca mudam a música a que o link aponta. */
const RASTREIO = /^(utm_.+|si|feature|pp|fbclid|gclid|igshid|igsh|ref_src|ref_url|mc_cid|mc_eid)$/i;

const HOST_LOCAL = /^(localhost|.+\.(local|localhost|internal|lan|home|arpa))$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export type LinkPreparado = { ok: true; url: string } | { ok: false; message: string };

/** O primeiro endereço http(s) dentro de um texto qualquer, sem a pontuação colada. */
export function extrairLink(texto: string): string | null {
  const achado = /https?:\/\/[^\s<>"'`]+/i.exec(texto);
  if (!achado) return null;
  return achado[0].replace(/[).,;:!?\]}»”’]+$/u, '');
}

export function limparRastreio(u: URL): URL {
  const limpo = new URL(u.toString());
  for (const chave of [...limpo.searchParams.keys()]) {
    if (RASTREIO.test(chave)) limpo.searchParams.delete(chave);
  }
  limpo.hash = '';
  return limpo;
}

/** Texto colado/compartilhado → link pronto para a fila, ou o motivo da recusa. */
export function prepararLink(texto: string): LinkPreparado {
  const bruto = extrairLink(texto.trim());
  if (!bruto) return { ok: false, message: 'Não achei um link aí. Cole o endereço da música.' };
  if (bruto.length > TAMANHO_MAX) return { ok: false, message: 'Esse link é grande demais.' };
  let u: URL;
  try {
    u = new URL(bruto);
  } catch {
    return { ok: false, message: 'Esse link não parece válido.' };
  }
  // Link com usuário/senha é truque clássico para disfarçar o destino
  // (https://spotify.com@site-malicioso/…).
  if (u.username || u.password)
    return { ok: false, message: 'Link com usuário/senha não é aceito.' };
  // Endereço de rede interna não é música de ninguém — é tentativa de fazer o
  // servidor olhar para dentro de casa.
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (IPV4.test(host) || host.startsWith('[') || HOST_LOCAL.test(host) || !host.includes('.')) {
    return { ok: false, message: 'Esse endereço não é de um site público.' };
  }
  if (u.port && u.port !== '80' && u.port !== '443') {
    return { ok: false, message: 'Link com porta não é aceito.' };
  }
  return { ok: true, url: limparRastreio(u).toString() };
}
