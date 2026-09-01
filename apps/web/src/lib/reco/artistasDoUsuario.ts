/**
 * OS ARTISTAS DELA, NÃO OS DO ACERVO.
 *
 * A grade de atalhos da tela inicial — a que fica logo abaixo do "Boa noite" —
 * mostrava artistas vindos de `localLibrary.artists()`. Essa função conta as
 * faixas da biblioteca INTEIRA, incluindo o acervo compartilhado, e ordena por
 * quantidade.
 *
 * O efeito: todo mundo abria o app e via os mesmos três nomes — os que por
 * acaso têm mais músicas no acervo. Uma grade que se chama "seus atalhos" e é
 * idêntica para cinco mil pessoas não é um atalho, é uma vitrine.
 *
 * ── O QUE É "DELA", DE VERDADE ──
 *
 * Três fontes, nesta ordem de força:
 *
 *   1. O QUE ELA TOCOU. É o sinal mais honesto que existe, e o único que ela
 *      não precisou declarar. Play recente pesa mais que play antigo — gosto
 *      muda, e o atalho serve para hoje.
 *   2. O QUE ELA CURTIU. Um coração é uma declaração deliberada; vale mais que
 *      um play, que pode ter sido acidente ou fila automática.
 *   3. O QUE ELA ESCOLHEU AO ENTRAR (o onboarding). Só isso existe no primeiro
 *      dia — e é exatamente para o primeiro dia que ele serve.
 *
 * A biblioteca entra apenas como ÚLTIMO recurso, e só quando as três acima não
 * produziram nada. Grade vazia numa conta nova seria pior que genérica.
 */
import type { TrackDto } from '@aurial/shared';
import type { LocalArtist } from '@/lib/local/localLibrary';

/** Meia-vida do play: o de um mês atrás vale metade do de hoje. */
const MEIA_VIDA_MS = 30 * 24 * 60 * 60 * 1000;
/** Uma curtida vale por vários plays — ela foi deliberada. */
const PESO_CURTIDA = 3;
/**
 * Peso da escolha do onboarding.
 *
 * Baixo de propósito: é o que sustenta o primeiro dia, mas o que a pessoa FAZ
 * precisa passar na frente do que ela DISSE assim que houver o que fazer.
 */
const PESO_SEMENTE = 2;

export interface EntradaDeHistorico {
  track: TrackDto;
  playedAt?: string;
}

function chave(nome: string): string {
  return nome.trim().toLowerCase();
}

function nomesDe(t: TrackDto): string[] {
  return (t.artists ?? [])
    .map((a) => a.name?.trim() ?? '')
    .filter((n) => n.length > 0 && n !== 'Desconhecido');
}

/**
 * Ordena os artistas da pessoa, do mais dela para o menos.
 *
 * Pura para poder ser testada: é a diferença entre uma grade pessoal e uma
 * lista dos artistas mais numerosos do acervo.
 */
export function artistasDoUsuario(
  historico: readonly EntradaDeHistorico[],
  curtidas: readonly TrackDto[],
  sementeArtistas: readonly string[],
  daBiblioteca: readonly LocalArtist[],
  opts: { now?: Date } = {},
): LocalArtist[] {
  const agora = (opts.now ?? new Date()).getTime();
  const peso = new Map<string, number>();
  const capa = new Map<string, string | null>();
  const rotulo = new Map<string, string>();

  const somar = (nome: string, quanto: number, coverUrl?: string | null): void => {
    const k = chave(nome);
    if (!k) return;
    peso.set(k, (peso.get(k) ?? 0) + quanto);
    if (!rotulo.has(k)) rotulo.set(k, nome);
    if (coverUrl && !capa.get(k)) capa.set(k, coverUrl);
  };

  for (const h of historico) {
    const idade = h.playedAt ? agora - new Date(h.playedAt).getTime() : MEIA_VIDA_MS;
    const recencia = Math.pow(0.5, Math.max(0, idade) / MEIA_VIDA_MS);
    for (const nome of nomesDe(h.track)) somar(nome, recencia, h.track.coverUrl);
  }
  for (const t of curtidas) {
    for (const nome of nomesDe(t)) somar(nome, PESO_CURTIDA, t.coverUrl);
  }
  for (const nome of sementeArtistas) somar(nome, PESO_SEMENTE);

  // A capa que a biblioteca já conhece completa quem entrou pela semente (que
  // é só um nome) — sem isso, o artista escolhido no onboarding apareceria com
  // o ícone genérico mesmo tendo arte disponível.
  const daBibliotecaPorChave = new Map(daBiblioteca.map((a) => [chave(a.name), a]));

  const ordenados = [...peso.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => {
      const conhecido = daBibliotecaPorChave.get(k);
      return {
        name: conhecido?.name ?? rotulo.get(k) ?? k,
        coverUrl: capa.get(k) ?? conhecido?.coverUrl ?? null,
        trackCount: conhecido?.trackCount ?? 0,
      };
    });

  // Último recurso, e só quando não há NADA da pessoa: conta nova precisa de
  // alguma coisa na grade.
  return ordenados.length > 0 ? ordenados : [...daBiblioteca];
}
