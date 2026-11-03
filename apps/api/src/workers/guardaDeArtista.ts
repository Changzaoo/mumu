/**
 * GUARDA CONTRA ARTISTA INVENTADO.
 *
 * A curadoria pergunta a uma IA "quem canta esta música?" e grava a resposta em
 * `track.artists`. A IA responde do que SABE sobre o título — e uma música de
 * nome comum ("Liberdade", "Evidências", "Amor") tem dezenas de intérpretes. O
 * resultado é a queixa do dono (03/11/2026): faixas passadas com o nome de OUTRO
 * artista, com um nome que não estava em lugar nenhum do vídeo.
 *
 * A regra: um nome só entra em `track.artists` se
 *   (a) aparece, por PALAVRAS INTEIRAS (sem acento/caixa), no título atual, no
 *       título original do vídeo, no canal, nos artistas atuais ou originais
 *       ou no selo da faixa; ou
 *   (b) foi confirmado por uma fonte de metadado real consultada pelo nome
 *       (Deezer: existe a faixa com ESTE título e ESTE artista).
 * Qualquer nome fora disso derruba a reescrita inteira: fica o que já estava e
 * o motivo vai para o log. Errar mantendo é invisível; errar trocando põe o nome
 * de outra pessoa numa música.
 *
 * Funções puras (as consultas de rede entram por parâmetro).
 */
import { normalizar, palavrasLimpas } from './escolhaEstrita.js';

export interface ContextoDaFaixa {
  tituloAtual: string;
  tituloOriginal?: string | null;
  artistasAtuais: string[];
  artistasOriginais?: string[];
  canal?: string | null;
  selo?: string | null;
}

/** `nome` aparece em `texto` como sequência de palavras inteiras? */
export function nomeApareceEm(nome: string, texto: string): boolean {
  const n = normalizar(nome);
  if (n.length < 2) return false;
  return ` ${normalizar(texto)} `.includes(` ${n} `);
}

/** Todos os textos em que a faixa "prova" um nome. */
export function textosDeProva(ctx: ContextoDaFaixa): string[] {
  return [
    ctx.tituloAtual,
    ctx.tituloOriginal ?? '',
    ctx.canal ?? '',
    ctx.selo ?? '',
    ...ctx.artistasAtuais,
    ...(ctx.artistasOriginais ?? []),
  ].filter((t) => typeof t === 'string' && t.trim().length > 0);
}

export type ConfirmarNaFonte = (titulo: string, artista: string) => Promise<boolean>;

export interface DecisaoDeArtistas {
  /** Os artistas a gravar (os propostos, se todos passaram; senão os atuais). */
  artistas: string[];
  /** A reescrita foi aceita? */
  aceita: boolean;
  /** Nomes propostos que não têm prova em lugar nenhum. */
  inventados: string[];
}

/**
 * Decide se a IA pode reescrever os artistas. Sempre devolve algo gravável: na
 * dúvida, os artistas atuais.
 */
export async function decidirArtistas(
  propostos: string[],
  ctx: ContextoDaFaixa,
  confirmar?: ConfirmarNaFonte,
): Promise<DecisaoDeArtistas> {
  const provas = textosDeProva(ctx);
  const inventados: string[] = [];
  for (const nome of propostos) {
    if (provas.some((t) => nomeApareceEm(nome, t))) continue;
    // Prova indireta de nome COMPOSTO: cada palavra do nome está nas provas? Não
    // basta (junta pedaços de pessoas diferentes) — só a fonte real confirma.
    let confirmado = false;
    if (confirmar) {
      try {
        confirmado = await confirmar(ctx.tituloAtual, nome);
      } catch {
        confirmado = false;
      }
    }
    if (!confirmado) inventados.push(nome);
  }
  if (inventados.length > 0 || propostos.length === 0) {
    return { artistas: ctx.artistasAtuais, aceita: false, inventados };
  }
  return { artistas: propostos, aceita: true, inventados: [] };
}

/**
 * Confirmação pelo Deezer: existe uma faixa com ESTE título (palavras inteiras,
 * igual) e ESTE artista (nome igual)? Sem rede ou sem resposta clara: `false`.
 */
export function confirmarNoDeezer(
  buscar: typeof fetch = (...args) => fetch(...args),
  timeoutMs = 6000,
): ConfirmarNaFonte {
  return async (titulo, artista) => {
    const alvoTitulo = palavrasLimpas(titulo).join(' ');
    const alvoArtista = normalizar(artista);
    if (!alvoTitulo || !alvoArtista) return false;
    const url = new URL('https://api.deezer.com/search');
    url.searchParams.set(
      'q',
      `artist:"${artista.replace(/"/g, '')}" track:"${titulo.replace(/"/g, '')}"`,
    );
    url.searchParams.set('limit', '8');
    const res = await buscar(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
    if (!res?.ok) return false;
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ title?: string; artist?: { name?: string } }>;
    } | null;
    return (json?.data ?? []).some(
      (d) =>
        palavrasLimpas(d.title ?? '').join(' ') === alvoTitulo &&
        normalizar(d.artist?.name ?? '') === alvoArtista,
    );
  };
}
