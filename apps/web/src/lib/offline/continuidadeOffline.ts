/**
 * CONTINUIDADE OFFLINE — sem internet, a música não pode parar de fazer sentido.
 *
 * O pedido original: "quando o usuário ficar sem conexão... tem que começar a
 * tocar as faixas que ele já tem no dispositivo, mas prestando atenção no tipo
 * de música que ele tá ouvindo — gênero, artista ou parecidos, e favoritismo".
 *
 * ── O QUE ESTE MÓDULO NÃO É ──
 *
 * Não é um motor de recomendação novo. É uma LENTE sobre o que já existe: pega
 * o que está tocando agora, filtra a biblioteca+downloads pelo que TOCA sem
 * rede (ver `disponivelOffline`), e ranqueia essa fatia com os mesmos sinais
 * que o resto do app já usa (artista, gênero, curtida, histórico — ver
 * `lib/reco`). A diferença é o filtro: nunca sugere o que precisaria de rede.
 *
 * ── OS DOIS GATILHOS ──
 *
 * 1. O evento `offline` do navegador — o caso óbvio.
 * 2. A faixa ATUAL ou a PRÓXIMA da fila não tem áudio neste aparelho enquanto
 *    `navigator.onLine` já está falso — cobre o caso de abrir o app já sem
 *    rede (o evento `offline` nunca dispara porque a queda foi antes do boot)
 *    e o caso de a fila avançar sozinha para uma faixa que não vai tocar.
 *
 * Ao voltar a rede (`online`), NADA é desfeito à força — a fila trocada
 * continua como está; só se prepara para avisar de novo na PRÓXIMA queda.
 *
 * ── PUREZA ──
 *
 * `montarContinuidadeOffline` é função pura: recebe a faixa de referência, o
 * que está disponível, histórico e curtidas, e devolve a ordem. Os sinais
 * "caros" (vetor semântico de artistas parecidos) são calculados FORA dela e
 * passados como `parecidos` — sem isso a função leria um cache de módulo
 * (embeddings) por dentro do caminho puro, e o mesmo defeito que already
 * mordeu `buildRecommendations` (sinal lido só faltaria à chave, aqui faltaria
 * ao próprio teste) se repetiria aqui.
 */
import type { TrackDto } from '@radinho/shared';
import { familiaDoGenero } from '@radinho/shared';
import { artistIdentityKey } from '@/lib/local/artistIdentity';
import { comVariedade } from '@/lib/reco/variedadeDeArtista';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localHistory from '@/lib/local/localHistory';
import * as localLikes from '@/lib/local/localLikes';
import { getDownloads } from '@/features/downloads/registry';
import { hasDownloadedAudio } from '@/features/downloads/downloadManager';
import { usePlayerStore } from '@/stores/playerStore';

// ── modelo de pontuação ──────────────────────────────────────────
const MEIA_VIDA_DIAS = 14; // mesma meia-vida do motor principal (ver recommend.ts)
const BONUS_CURTIDA = 3; // curtida é o sinal mais forte — mesmo peso do resto do app
const PESO_MESMO_ARTISTA = 6;
const PESO_ARTISTA_PARECIDO = 4;
const PESO_MESMO_GENERO = 2;
const PESO_GENERO_VIZINHO = 1;
/** Faixas tocadas HÁ POUCO (mas fora da janela de exclusão) pesam menos — não
 *  saem da lista, só descem, para não competir com o que a pessoa nem tocou. */
const PENALIDADE_RECENTE = 0.35;
/** Acabaram de tocar: fora de cogitação — repetir na cara seria pior que nada. */
const JANELA_EXCLUSAO = 3;
/** Além da exclusão, ainda "recente" o bastante para pesar menos. */
const JANELA_PENALIDADE = 15;
/** Poda antes da passada de variedade — a lista pode ter milhares de faixas
 *  disponíveis; só o topo do ranking pode virar a fila final. */
const POOL_MAX = 200;
const LIMITE_PADRAO = 30;

export interface EntradaHistoricoOffline {
  track: TrackDto;
  playedAt: string;
}

export interface ContinuidadeOfflineInputs {
  /** A faixa que estava tocando quando a rede caiu (ou `null` sem referência). */
  atual: TrackDto | null;
  /** SÓ o que toca sem rede — áudio local da biblioteca ou baixado. */
  disponiveis: readonly TrackDto[];
  historico: readonly EntradaHistoricoOffline[];
  curtidas: readonly TrackDto[];
  /** Ids semanticamente parecidos com `atual` (embeddings) — best-effort,
   *  calculado por quem chama; vazio quando não há vetor (offline, sem IA). */
  parecidos?: ReadonlySet<string>;
  now?: Date;
  limite?: number;
}

function nomeArtista(t: TrackDto): string {
  return t.artists?.[0]?.name ?? '';
}

function chaveGenero(genero: string | null | undefined): string | null {
  const g = genero?.trim();
  return g ? g.toLowerCase() : null;
}

function pesoDecaido(playedAt: string, nowMs: number): number {
  const at = Date.parse(playedAt);
  if (!Number.isFinite(at)) return 0;
  const dias = Math.max(0, (nowMs - at) / 86_400_000);
  return Math.exp(-dias / MEIA_VIDA_DIAS);
}

function bump(mapa: Map<string, number>, chave: string, delta: number): void {
  if (!chave) return;
  mapa.set(chave, (mapa.get(chave) ?? 0) + delta);
}

/**
 * A ordem da continuação offline. Pura — recebe tudo, não lê módulo nenhum.
 *
 * Critério de ranking (do mais forte para o mais fraco):
 *   1. mesmo artista da faixa atual;
 *   2. artista parecido (semântico, via `parecidos`);
 *   3. mesmo gênero;
 *   4. gênero vizinho (mesma família — `familiaDoGenero`, ver @radinho/shared);
 *   + afinidade de artista/gênero aprendida do histórico (decaimento de 14 dias);
 *   + bônus de curtida (×3, o sinal mais forte que existe);
 *   + leve bônus por quantas vezes já tocou (favoritismo cru);
 *   × penalidade se tocou há pouco (não exclui — só desce).
 * No fim, variedade de artista: nunca mais que duas seguidas do mesmo.
 */
export function montarContinuidadeOffline(inputs: ContinuidadeOfflineInputs): TrackDto[] {
  const now = inputs.now ?? new Date();
  const nowMs = now.getTime();
  const limite = inputs.limite ?? LIMITE_PADRAO;
  const parecidos = inputs.parecidos ?? new Set<string>();

  const candidatos = inputs.disponiveis.filter((t) => t.id !== inputs.atual?.id);
  if (candidatos.length === 0) return [];

  // ── afinidade aprendida (mesmo espírito de recommend.ts, self-contained) ──
  const artistAffinity = new Map<string, number>();
  const genreAffinity = new Map<string, number>();
  const playsByTrack = new Map<string, number>();

  for (const h of inputs.historico) {
    const w = pesoDecaido(h.playedAt, nowMs);
    bump(playsByTrack, h.track.id, 1);
    bump(artistAffinity, artistIdentityKey(nomeArtista(h.track)), w);
    const g = chaveGenero(h.track.genre);
    if (g) bump(genreAffinity, g, w);
  }
  for (const liked of inputs.curtidas) {
    bump(artistAffinity, artistIdentityKey(nomeArtista(liked)), BONUS_CURTIDA);
    const g = chaveGenero(liked.genre);
    if (g) bump(genreAffinity, g, BONUS_CURTIDA);
  }
  const curtidasIds = new Set(inputs.curtidas.map((t) => t.id));

  // Recém-tocadas: as últimas `JANELA_EXCLUSAO` nem entram (acabaram de soar);
  // até `JANELA_PENALIDADE` ainda pesam menos, para variar sem repetir.
  const excluidas = new Set(inputs.historico.slice(0, JANELA_EXCLUSAO).map((h) => h.track.id));
  const recentes = new Set(
    inputs.historico.slice(JANELA_EXCLUSAO, JANELA_PENALIDADE).map((h) => h.track.id),
  );

  const artistaAtual = inputs.atual ? artistIdentityKey(nomeArtista(inputs.atual)) : '';
  const generoAtual = chaveGenero(inputs.atual?.genre);
  const familiaAtual = familiaDoGenero(inputs.atual?.genre ?? null);

  function pontuar(t: TrackDto): number {
    let score = 0;
    const artKey = artistIdentityKey(nomeArtista(t));
    const genero = chaveGenero(t.genre);
    const mesmoArtista = artistaAtual !== '' && artKey !== '' && artKey === artistaAtual;
    const parecido = !mesmoArtista && parecidos.has(t.id);
    const mesmoGenero =
      !mesmoArtista && !parecido && generoAtual !== null && genero === generoAtual;
    const familiaCandidata = familiaDoGenero(t.genre);
    const generoVizinho =
      !mesmoArtista &&
      !parecido &&
      !mesmoGenero &&
      familiaAtual !== null &&
      familiaCandidata === familiaAtual;

    if (mesmoArtista) score += PESO_MESMO_ARTISTA;
    else if (parecido) score += PESO_ARTISTA_PARECIDO;
    else if (mesmoGenero) score += PESO_MESMO_GENERO;
    else if (generoVizinho) score += PESO_GENERO_VIZINHO;

    score += artistAffinity.get(artKey) ?? 0;
    if (genero) score += 0.5 * (genreAffinity.get(genero) ?? 0);
    if (curtidasIds.has(t.id)) score += BONUS_CURTIDA;
    // Favoritismo cru: quantas vezes já tocou, com teto — não pode sozinho
    // superar um "mesmo artista" ou uma curtida.
    score += Math.min(playsByTrack.get(t.id) ?? 0, 5) * 0.2;

    if (excluidas.has(t.id)) return -1; // sinal de "fora", tratado abaixo
    if (recentes.has(t.id)) score *= PENALIDADE_RECENTE;
    return score;
  }

  const pontuados = candidatos
    .map((t) => ({ t, score: pontuar(t) }))
    .filter((c) => c.score > -1) // -1 marca "acabou de tocar" — fora da lista
    .sort((a, b) => b.score - a.score)
    .slice(0, POOL_MAX)
    .map((c) => c.t);

  return comVariedade(pontuados, limite);
}

/**
 * O QUE VEM DEPOIS DA ATUAL, SEM REDE: primeiro a FILA DA PESSOA (só o que toca
 * aqui, na ordem dela), depois a continuação por parecença.
 *
 * Antes a continuação SUBSTITUÍA tudo o que vinha depois: uma playlist baixada
 * com uma faixa não baixada no meio virava, na queda da rede, uma lista de
 * "parecidas" da biblioteca inteira — as baixadas da própria playlist iam
 * parar espalhadas (ou fora) dela. A regra é continuar a fila pelas baixadas e
 * só pular as que não estão aqui; a continuação entra quando a fila acaba.
 * Pura: recebe o que resta da fila e o teste de disponibilidade.
 */
export function emendarNaFila(
  restanteDaFila: readonly TrackDto[],
  continuacao: readonly TrackDto[],
  tocaSemRede: (id: string) => boolean,
): TrackDto[] {
  const daFila = restanteDaFila.filter((t) => tocaSemRede(t.id));
  const naFila = new Set(daFila.map((t) => t.id));
  return [...daFila, ...continuacao.filter((t) => !naFila.has(t.id))];
}

// ── orquestração (o lado que lê módulos e mexe no player) ─────────────────

/** Áudio desta faixa existe NESTE aparelho — biblioteca própria OU download. */
function disponivelOffline(id: string): boolean {
  return localLibrary.hasLocalAudio(id) || hasDownloadedAudio(id);
}

/** Tudo o que toca sem rede agora: biblioteca + downloads, sem duplicar id. */
function coletarDisponiveisOffline(): TrackDto[] {
  const porId = new Map<string, TrackDto>();
  for (const entry of localLibrary.list()) {
    if (localLibrary.hasLocalAudio(entry.track.id)) porId.set(entry.track.id, entry.track);
  }
  for (const entry of getDownloads()) {
    if (!porId.has(entry.track.id) && hasDownloadedAudio(entry.track.id)) {
      porId.set(entry.track.id, entry.track);
    }
  }
  return [...porId.values()];
}

/**
 * Vizinhos semânticos de `atual` dentro do que está disponível — best-effort.
 * `similarTo` já devolve `[]` sozinho sem vetores (offline/deslogado/sem IA);
 * o `try/catch` é só para o caso raro de o próprio import dinâmico falhar.
 */
async function parecidosSemânticos(
  atual: TrackDto | null,
  disponiveis: readonly TrackDto[],
): Promise<ReadonlySet<string>> {
  if (!atual) return new Set();
  try {
    const { similarTo } = await import('@/lib/reco/semanticMixes');
    return new Set(similarTo(atual, disponiveis, 40).map((t) => t.id));
  } catch {
    return new Set();
  }
}

function estaOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Avisa uma vez por queda de conexão — não uma vez por faixa (ver `pularFaixaMorta`). */
let avisadoNestaQueda = false;

function avisar(): void {
  if (avisadoNestaQueda) return;
  avisadoNestaQueda = true;
  void import('sonner').then(({ toast }) =>
    toast('Sem internet — continuando com músicas do seu aparelho parecidas com o que você ouvia'),
  );
}

/**
 * Monta a continuação e aplica no player SEM interromper a faixa atual —
 * `setUpNext` é a API pública que só troca o que vem DEPOIS dela.
 *
 * Se a atual não toca sem rede (morreu ou nunca tocaria), avança para a
 * primeira da continuação — não há o que esperar, ela já não ia soar.
 */
async function aplicarContinuidade(atual: TrackDto | null): Promise<void> {
  const disponiveis = coletarDisponiveisOffline();
  if (disponiveis.length === 0) return; // nada no aparelho: não há o que fazer

  const historico = localHistory
    .listForCurrentUser()
    .map((e): EntradaHistoricoOffline => ({ track: e.track, playedAt: e.playedAt }));
  const curtidas = localLikes.list();
  const parecidos = await parecidosSemânticos(atual, disponiveis);

  // A rede pode ter voltado enquanto os vetores carregavam — reconferir evita
  // trocar a fila de quem já está online de novo.
  if (!estaOffline()) return;

  const continuacao = montarContinuidadeOffline({
    atual,
    disponiveis,
    historico,
    curtidas,
    parecidos,
  });
  const estado = usePlayerStore.getState();
  // A fila pode ter andado enquanto os vetores carregavam.
  if (estado.currentTrack?.id !== atual?.id) return;
  const aSeguir = emendarNaFila(
    estado.queue.slice(estado.queueIndex + 1),
    continuacao,
    disponivelOffline,
  );
  if (aSeguir.length === 0) return;

  estado.setUpNext(aSeguir);
  avisar();

  // Só avança se a pessoa está OUVINDO. Ao abrir o app já sem rede, a faixa
  // restaurada vem pausada: avançar aqui dava play sozinho (sem gesto — o
  // navegador recusa e sobra um erro na tela) e ainda jogava fora a faixa que
  // ela ia retomar. Pausada, o play dela cai no caminho normal do player, que
  // sem rede já segue para a próxima baixada.
  if (!disponivelOffline(atual?.id ?? '') && estado.isPlaying) {
    estado.next();
  }
}

let trabalhando = false;

/** Confere se a fila precisa de socorro AGORA (rede fora + faixa sem cópia). */
function verificar(): void {
  if (!estaOffline()) {
    avisadoNestaQueda = false; // prepara o aviso para a PRÓXIMA queda
    return; // "ao voltar a conexão, não desfaz nada à força"
  }
  if (trabalhando) return;

  const state = usePlayerStore.getState();
  const atual = state.currentTrack;
  const proxima = state.queueIndex >= 0 ? (state.queue[state.queueIndex + 1] ?? null) : null;
  const atualOk = disponivelOffline(atual?.id ?? '');
  const proximaOk = proxima ? disponivelOffline(proxima.id) : true;
  // Atual e próxima já tocam sem rede: a fila já está segura, não mexe nela
  // (evitar substituir a toda hora enquanto ela é consumida normalmente).
  if (atualOk && proximaOk) return;

  trabalhando = true;
  void aplicarContinuidade(atual).finally(() => {
    trabalhando = false;
  });
}

let iniciado = false;

/**
 * Liga a continuidade offline uma única vez (chamado no boot, junto do
 * guardião de download — ver App.tsx).
 */
export function initContinuidadeOffline(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;

  window.addEventListener('offline', verificar);
  window.addEventListener('online', verificar);
  // A fila avança sozinha (faixa terminou, pulo automático): reconferir a
  // cada troca cobre o caso de a próxima da fila não ter cópia aqui, mesmo
  // sem um novo evento `offline` (a queda pode ter acontecido antes do boot).
  usePlayerStore.subscribe((state, prev) => {
    if (state.currentTrack?.id !== prev.currentTrack?.id || state.queueIndex !== prev.queueIndex) {
      verificar();
    }
  });
  // App aberto JÁ sem rede: sem isto, a primeira verificação só viria com uma
  // troca de faixa ou um evento que nunca dispara (a queda foi antes do boot).
  verificar();
}
