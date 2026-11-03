/**
 * Validacao dos enderecos de audio que um usuario comum publica no acervo.
 * Sem isto, qualquer conta podia apontar uma faixa para um host qualquer.
 * ADMIN nao passa por aqui (decisao do chamador).
 */
import { env } from '../../config/env.js';

type Obj = Record<string, unknown>;

const HOSTS_DE_ORIGEM = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'soundcloud.com',
  'bandcamp.com',
  'vimeo.com',
];

function hostDe(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostsDeAudio(): string[] {
  const csv = (env.CATALOGO_HOSTS_DE_AUDIO ?? '').split(',');
  const lista = [
    ...csv.map((h) => h.trim().toLowerCase()),
    hostDe(env.IMPORTER_PUBLIC_URL),
    hostDe(env.IMPORTER_URL),
  ];
  return lista.filter((h): h is string => !!h);
}

/** Igual ao host ou subdominio dele. */
function casa(host: string, permitidos: string[]): boolean {
  return permitidos.some((p) => host === p || host.endsWith(`.${p}`));
}

function urlValida(valor: unknown, permitidos: string[]): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor !== 'string') return false;
  if (valor.trim() === '') return true;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return casa(u.hostname.toLowerCase(), permitidos);
}

/** true se `remoteUrl`, `track.streamUrl` e `sourceUrl` da entrada sao aceitaveis. */
export function hostsDaEntradaValidos(entrada: unknown): boolean {
  const e = (entrada ?? {}) as Obj;
  const audio = hostsDeAudio();
  const origem = [...audio, ...HOSTS_DE_ORIGEM];
  const track = e.track && typeof e.track === 'object' ? (e.track as Obj) : {};
  return (
    urlValida(e.remoteUrl, audio) &&
    urlValida(track.streamUrl, audio) &&
    urlValida(e.sourceUrl, origem)
  );
}
