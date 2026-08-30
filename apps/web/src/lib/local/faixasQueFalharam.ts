/**
 * O MAPA DAS FAIXAS QUE NÃO TOCARAM — não o sintoma, o caso.
 *
 * POR QUE ISTO EXISTE. Quando uma faixa falha, o player faz a coisa certa para
 * quem está ouvindo: mostra "indisponível — pulando" e segue para a próxima.
 * Só que aí a informação morre ali. Ninguém sabe QUAL faixa era, quantas
 * pessoas bateram nela, nem — o que mais importa — se ela tinha conserto. O
 * resultado prático é o que se via: "tem música dando erro e ninguém conserta",
 * porque de fato não havia lista para consertar.
 *
 * `playbackDiagnosis.ts` já sabia dizer qual elo da cadeia rompeu, mas só
 * quando alguém abria o console e pedia. Este módulo é o mesmo diagnóstico
 * acontecendo sozinho, na hora da falha real, sem ninguém pedir.
 *
 * O QUE SE GUARDA, E POR QUE ESSES CAMPOS. Não basta saber que falhou; é
 * preciso saber se DÁ PARA CONSERTAR. Quem responde isso é o `sourceUrl`: com
 * ele, a faixa pode ser baixada de novo da origem e volta a tocar; sem ele, ela
 * está perdida de verdade e a resposta honesta é tirá-la da vitrine em vez de
 * prometer som que não existe. Por isso a cadeia inteira é registrada — áudio
 * no aparelho, cópia no cofre, link de origem — e não só o "deu erro".
 *
 * UM CASO POR FAIXA, NÃO UM POR TENTATIVA. Uma faixa que falha quarenta vezes é
 * um problema, não quarenta. O registro conta as repetições e guarda a primeira
 * e a última vez; sem isso, uma noite de fila ruim encheria o armazenamento com
 * milhares de linhas do mesmo caso e afogaria os casos distintos, que são
 * justamente o que interessa.
 *
 * SOBE PARA O SERVIDOR pela mesma via das curtidas (`serverCollection`, com
 * fila em disco). Isso é o que transforma "o app de alguém deu erro" numa lista
 * que dá para varrer e reparar — inclusive de outro aparelho, e inclusive
 * depois que a pessoa fechou o app.
 */
import type { TrackDto } from '@aurial/shared';
import { serverCollection } from '@/lib/sync/serverCollection';

const CHAVE = 'aurial:faixas-que-falharam';

/**
 * Teto de casos guardados.
 *
 * Existe porque isto é diagnóstico, não acervo: passar de alguns milhares de
 * casos distintos não melhora o reparo e começa a disputar a cota do
 * localStorage com coisa que a pessoa perderia de verdade (curtidas,
 * playlists). Quando estoura, saem os mais VELHOS já reparados primeiro, e só
 * depois os mais velhos em geral — um caso reparado já cumpriu o seu papel.
 */
const MAX_CASOS = 400;

export type MotivoDaFalha =
  /** Nenhuma fonte para tentar: sem áudio local, sem cópia, sem link. */
  | 'sem-fonte'
  /** Havia fonte, e todas morreram (404/403, cofre fora do ar, token vencido). */
  | 'fonte-morta'
  /** A fonte respondeu, mas o áudio não tocou (arquivo corrompido, formato). */
  | 'erro-de-midia';

export interface FalhaRegistrada {
  trackId: string;
  titulo: string;
  artista: string;
  motivo: MotivoDaFalha;
  /** O que existia na cadeia quando falhou — é isto que diz se tem conserto. */
  tinhaAudioLocal: boolean;
  tinhaCopiaRemota: boolean;
  /** O caminho de volta. Sem ele não há reparo possível. */
  sourceUrl?: string;
  primeiraEm: string;
  ultimaEm: string;
  vezes: number;
  /** Preenchido quando a faixa voltou a tocar depois de um reparo. */
  reparadaEm?: string;
  /** Quantas vezes o reparo já foi tentado — segura o laço infinito. */
  tentativasDeReparo?: number;
}

export interface ContextoDaFalha {
  tinhaAudioLocal: boolean;
  tinhaCopiaRemota: boolean;
  sourceUrl?: string;
}

let cache: Record<string, FalhaRegistrada> | null = null;
const ouvintes = new Set<() => void>();

function emitir(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function ler(): Record<string, FalhaRegistrada> {
  if (cache) return cache;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : {};
    cache = lido && typeof lido === 'object' ? (lido as Record<string, FalhaRegistrada>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Poda pelo teto: primeiro os reparados mais velhos, depois os mais velhos. */
function podar(mapa: Record<string, FalhaRegistrada>): Record<string, FalhaRegistrada> {
  const casos = Object.values(mapa);
  if (casos.length <= MAX_CASOS) return mapa;
  const ordem = [...casos].sort((a, b) => {
    if (Boolean(a.reparadaEm) !== Boolean(b.reparadaEm)) return a.reparadaEm ? -1 : 1;
    return a.ultimaEm.localeCompare(b.ultimaEm);
  });
  const remover = new Set(ordem.slice(0, casos.length - MAX_CASOS).map((c) => c.trackId));
  const saida: Record<string, FalhaRegistrada> = {};
  for (const [id, caso] of Object.entries(mapa)) if (!remover.has(id)) saida[id] = caso;
  return saida;
}

function gravar(mapa: Record<string, FalhaRegistrada>): void {
  cache = podar(mapa);
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(cache));
  } catch {
    /* cota: o registro é diagnóstico — nunca vale derrubar a tela por ele */
  }
  emitir();
}

/** Aplica sem re-enviar — caminho por onde a sincronia entrega o de fora. */
function aplicarRemoto(caso: FalhaRegistrada): void {
  const mapa = ler();
  const atual = mapa[caso.trackId];
  // O aparelho com a notícia MAIS RECENTE vence; um reparo confirmado em
  // qualquer aparelho vale para todos, então ele nunca é desfeito por um
  // registro antigo que ainda achava a faixa quebrada.
  if (atual && atual.ultimaEm > caso.ultimaEm && !caso.reparadaEm) return;
  gravar({ ...mapa, [caso.trackId]: { ...atual, ...caso } });
}

const nuvem = serverCollection<FalhaRegistrada>({
  // 'falhas' precisa estar na lista fechada de
  // apps/api/src/modules/collections/collections.controller.ts.
  name: 'falhas',
  localItems: () => Object.entries(ler()),
  onRemoteUpsert: (_id, data) => aplicarRemoto(data),
  onRemoteDelete: (id) => {
    const mapa = { ...ler() };
    delete mapa[id];
    gravar(mapa);
  },
});

export const setUser = nuvem.setUser;

/**
 * Registra que ESTA faixa não tocou.
 *
 * Chamado no funil único de morte do player (`failCurrentTrack`), depois de
 * todas as tentativas de fonte terem se esgotado — nunca no meio da cadeia,
 * senão o registro encheria de faixas que a tentativa seguinte resolveu.
 */
export function registrar(
  track: Pick<TrackDto, 'id' | 'title' | 'artists'>,
  motivo: MotivoDaFalha,
  contexto: ContextoDaFalha,
): void {
  const agora = new Date().toISOString();
  const mapa = ler();
  const anterior = mapa[track.id];
  const caso: FalhaRegistrada = {
    trackId: track.id,
    titulo: track.title ?? '',
    artista: track.artists?.[0]?.name ?? '',
    motivo,
    tinhaAudioLocal: contexto.tinhaAudioLocal,
    tinhaCopiaRemota: contexto.tinhaCopiaRemota,
    sourceUrl: contexto.sourceUrl,
    primeiraEm: anterior?.primeiraEm ?? agora,
    ultimaEm: agora,
    vezes: (anterior?.vezes ?? 0) + 1,
    tentativasDeReparo: anterior?.tentativasDeReparo,
    // Falhou DE NOVO depois de reparada: o reparo não pegou, e o caso volta a
    // ser um caso. Sem isto, uma faixa reparada por engano ficaria para sempre
    // fora da lista de reparo, invisível.
    reparadaEm: undefined,
  };
  gravar({ ...mapa, [track.id]: caso });
  nuvem.push(track.id, caso);
}

/** A faixa voltou a tocar — o caso está encerrado, mas não apagado. */
export function marcarReparada(trackId: string): void {
  const mapa = ler();
  const caso = mapa[trackId];
  if (!caso || caso.reparadaEm) return;
  const atualizado = { ...caso, reparadaEm: new Date().toISOString() };
  gravar({ ...mapa, [trackId]: atualizado });
  nuvem.push(trackId, atualizado);
}

/** Conta mais uma tentativa de reparo (para o teto do reparador). */
export function anotarTentativaDeReparo(trackId: string): void {
  const mapa = ler();
  const caso = mapa[trackId];
  if (!caso) return;
  const atualizado = { ...caso, tentativasDeReparo: (caso.tentativasDeReparo ?? 0) + 1 };
  gravar({ ...mapa, [trackId]: atualizado });
  nuvem.push(trackId, atualizado);
}

/** Todos os casos, do mais recente para o mais antigo. */
export function lista(): FalhaRegistrada[] {
  return Object.values(ler()).sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm));
}

/** Os casos ainda abertos (não reparados). */
export function emAberto(): FalhaRegistrada[] {
  return lista().filter((c) => !c.reparadaEm);
}

/**
 * Os casos que TÊM conserto: falharam, não foram reparados, e guardam o link de
 * origem para baixar de novo. É exatamente a fila do reparador.
 *
 * `maxTentativas` existe porque um link que falha por um motivo que nunca vai
 * mudar (vídeo removido do YouTube) ficaria eternamente sendo rebaixado e
 * reenfileirado, gastando rede de todo mundo para nada.
 */
export function reparaveis(maxTentativas = 3): FalhaRegistrada[] {
  return emAberto().filter(
    (c) => Boolean(c.sourceUrl) && (c.tentativasDeReparo ?? 0) < maxTentativas,
  );
}

/**
 * Os casos SEM conserto: nem cópia, nem link de origem.
 *
 * Não é um detalhe burocrático — é a única categoria em que a resposta certa
 * não é tentar de novo, e sim parar de anunciar a faixa. Prometer som que não
 * existe é pior que admitir que ela se perdeu.
 */
export function semConserto(): FalhaRegistrada[] {
  return emAberto().filter((c) => !c.sourceUrl);
}

/** Números para a tela de diagnóstico. */
export function resumo(): {
  total: number;
  abertas: number;
  reparaveis: number;
  semConserto: number;
  reparadas: number;
} {
  const todas = lista();
  return {
    total: todas.length,
    abertas: todas.filter((c) => !c.reparadaEm).length,
    reparaveis: reparaveis().length,
    semConserto: semConserto().length,
    reparadas: todas.filter((c) => c.reparadaEm).length,
  };
}

/** Esquece tudo — usado pela tela de diagnóstico e pelos testes. */
export function limpar(): void {
  cache = {};
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
  emitir();
}
