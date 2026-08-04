/**
 * O time de recomendação: cada agente responde UMA pergunta sobre o gosto do
 * usuário, e as respostas viram prateleiras diferentes.
 *
 * POR QUE SEPARAR EM AGENTES: um motor único de "afinidade" mistura sinais que
 * dizem coisas diferentes. Gostar de sertanejo é uma coisa; gostar de sertanejo
 * ÀS SETE DA MANHÃ DE SEGUNDA é outra, e é a segunda que faz o app parecer que
 * conhece a pessoa. Cada agente aqui olha um recorte e não contamina os outros.
 *
 * O time:
 *   RELÓGIO    — o que ele ouve NESTA hora, separando dia útil de fim de semana
 *   CALENDÁRIO — a rotina da semana contra a do fim de semana
 *   SINGLES    — faixa avulsa, para quem ouve música e não disco
 *   ÁLBUNS     — disco inteiro, para quem ouve obra fechada
 *   LETRAS     — do que as músicas dele FALAM, não de quem as canta
 *
 * Tudo aqui é função pura sobre os dados que entram. Sem rede, sem relógio
 * escondido (a hora é sempre parâmetro), sem estado — é o que permite testar
 * recomendação de verdade, em vez de olhar a tela e torcer.
 */
import type { TrackDto } from '@aurial/shared';
import type { RecoEntry, RecoPlay } from '@/lib/reco/recommend';

export interface AgenteInputs {
  entries: readonly RecoEntry[];
  history: readonly RecoPlay[];
  liked: readonly TrackDto[];
  now: Date;
}

/** Uma prateleira produzida por um agente. */
export interface Prateleira {
  key: string;
  title: string;
  subtitle: string;
  tracks: TrackDto[];
}

/** Quantas faixas uma prateleira mostra. */
const TAMANHO = 20;
/** Abaixo disto o recorte não tem sinal — melhor não inventar prateleira. */
const MIN_PLAYS = 6;

// ── utilidades comuns ───────────────────────────────────────────

function ehFimDeSemana(d: Date): boolean {
  const dia = d.getDay();
  return dia === 0 || dia === 6;
}

/** Faixas distintas, na ordem em que aparecem. */
function unicas(tracks: readonly TrackDto[]): TrackDto[] {
  const vistos = new Set<string>();
  const out: TrackDto[] = [];
  for (const t of tracks) {
    if (vistos.has(t.id)) continue;
    vistos.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * Ordena por quantas vezes cada faixa aparece no recorte, desempatando pela
 * mais recente. Contar é o suficiente: dentro de um recorte estreito (uma faixa
 * de horário, um tipo de dia) o que se repete É o hábito.
 */
function porRecorrencia(plays: readonly RecoPlay[]): TrackDto[] {
  const contagem = new Map<string, { n: number; quando: number; track: TrackDto }>();
  for (const p of plays) {
    const quando = new Date(p.playedAt).getTime();
    const atual = contagem.get(p.track.id);
    if (atual) {
      atual.n += 1;
      atual.quando = Math.max(atual.quando, quando);
    } else {
      contagem.set(p.track.id, { n: 1, quando, track: p.track });
    }
  }
  return [...contagem.values()]
    .sort((a, b) => b.n - a.n || b.quando - a.quando)
    .map((x) => x.track);
}

// ── AGENTE DO RELÓGIO ───────────────────────────────────────────

/** Faixa de horário com nome que uma pessoa reconhece. */
export function faixaDoDia(hour: number): { key: string; nome: string } {
  if (hour < 6) return { key: 'madrugada', nome: 'para a madrugada' };
  if (hour < 12) return { key: 'manha', nome: 'para a manhã' };
  if (hour < 18) return { key: 'tarde', nome: 'para a tarde' };
  return { key: 'noite', nome: 'para a noite' };
}

/**
 * O que ele ouve NESTA hora, neste tipo de dia.
 *
 * O recorte é hora × tipo-de-dia de propósito: a trilha das 8h de terça (a
 * caminho do trabalho) não tem nada a ver com a das 8h de domingo. Cruzar os
 * dois sinais é o que separa "ele gosta disso de manhã" de "ele gosta disso na
 * manhã de FOLGA".
 */
export function agenteDoRelogio(inputs: AgenteInputs): Prateleira | null {
  const { history, now } = inputs;
  const fimDeSemana = ehFimDeSemana(now);
  const faixa = faixaDoDia(now.getHours());

  const noRecorte = history.filter((p) => {
    const d = new Date(p.playedAt);
    if (Number.isNaN(d.getTime())) return false;
    if (ehFimDeSemana(d) !== fimDeSemana) return false;
    return faixaDoDia(d.getHours()).key === faixa.key;
  });

  if (noRecorte.length < MIN_PLAYS) return null;

  const tracks = porRecorrencia(noRecorte).slice(0, TAMANHO);
  if (tracks.length < 4) return null;

  const quando = fimDeSemana ? 'de fim de semana' : 'de dia de semana';
  return {
    key: `reco:relogio:${faixa.key}:${fimDeSemana ? 'fds' : 'util'}`,
    title: `Sua ${faixa.nome.replace(/^para a /, '')} ${quando}`,
    subtitle: `O que você costuma ouvir ${faixa.nome} ${quando}`,
    tracks,
  };
}

// ── AGENTE DO CALENDÁRIO ────────────────────────────────────────

/**
 * A rotina da semana contra a do fim de semana, no dia inteiro.
 *
 * É o irmão de vista larga do agente do relógio: quando o recorte por hora não
 * tem plays suficientes, o tipo de dia sozinho ainda diz muito — e quando tem,
 * as duas prateleiras convivem falando de coisas diferentes.
 *
 * Só entram faixas que são MAIS deste tipo de dia que do outro. Sem esse
 * filtro, a prateleira "seu fim de semana" viria cheia das mesmas músicas que
 * ele ouve todo dia, e não diria nada.
 */
export function agenteDoCalendario(inputs: AgenteInputs): Prateleira | null {
  const { history, now } = inputs;
  const fimDeSemana = ehFimDeSemana(now);

  const dentro = new Map<string, number>();
  const fora = new Map<string, number>();
  const porId = new Map<string, TrackDto>();

  for (const p of history) {
    const d = new Date(p.playedAt);
    if (Number.isNaN(d.getTime())) continue;
    porId.set(p.track.id, p.track);
    const alvo = ehFimDeSemana(d) === fimDeSemana ? dentro : fora;
    alvo.set(p.track.id, (alvo.get(p.track.id) ?? 0) + 1);
  }

  if ([...dentro.values()].reduce((a, b) => a + b, 0) < MIN_PLAYS) return null;

  const caracteristicas = [...dentro.entries()]
    .filter(([id, n]) => n > (fora.get(id) ?? 0))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => porId.get(id))
    .filter((t): t is TrackDto => Boolean(t))
    .slice(0, TAMANHO);

  if (caracteristicas.length < 4) return null;

  return {
    key: `reco:calendario:${fimDeSemana ? 'fds' : 'util'}`,
    title: fimDeSemana ? 'Seu fim de semana' : 'Sua semana',
    subtitle: fimDeSemana
      ? 'O que só toca quando você está de folga'
      : 'A trilha dos seus dias de semana',
    tracks: caracteristicas,
  };
}

// ── AGENTE DE SINGLES ───────────────────────────────────────────

/**
 * Uma faixa é "single" quando não pertence a um disco de verdade.
 *
 * O critério tem que ser esse porque o importador preenche `album` com o nome
 * da própria música em faixa avulsa — checar só a existência do campo faria
 * toda música ser de álbum e a prateleira de singles nascer vazia.
 */
export function ehSingle(track: TrackDto, tamanhoDoAlbum: (titulo: string) => number): boolean {
  const album = track.album?.title?.trim();
  if (!album) return true;
  if (album.toLowerCase() === track.title.trim().toLowerCase()) return true;
  if (/\b(single|ep)\b/i.test(album)) return true;
  return tamanhoDoAlbum(album) < 2;
}

/**
 * Faixas avulsas de artistas que ele já ouve — para quem consome música, não
 * disco. Nunca repete o que já está no histórico recente: prateleira de
 * descoberta que devolve o que a pessoa acabou de ouvir não descobre nada.
 */
export function agenteDeSingles(inputs: AgenteInputs): Prateleira | null {
  const { entries, history, liked } = inputs;

  const tamanhos = new Map<string, number>();
  for (const e of entries) {
    const a = e.track.album?.title?.trim().toLowerCase();
    if (a) tamanhos.set(a, (tamanhos.get(a) ?? 0) + 1);
  }
  const tamanhoDoAlbum = (titulo: string): number => tamanhos.get(titulo.toLowerCase()) ?? 0;

  // Artistas com afinidade: play recente ou curtida.
  const afins = new Set<string>();
  for (const p of history.slice(0, 200)) {
    for (const a of p.track.artists) afins.add(a.name.toLowerCase());
  }
  for (const t of liked) for (const a of t.artists) afins.add(a.name.toLowerCase());
  if (afins.size === 0) return null;

  const ouvidas = new Set(history.slice(0, 120).map((p) => p.track.id));

  const candidatas = entries
    .map((e) => e.track)
    .filter((t) => !ouvidas.has(t.id))
    .filter((t) => ehSingle(t, tamanhoDoAlbum))
    .filter((t) => t.artists.some((a) => afins.has(a.name.toLowerCase())));

  const tracks = unicas(candidatas).slice(0, TAMANHO);
  if (tracks.length < 4) return null;

  return {
    key: 'reco:singles',
    title: 'Singles para você',
    subtitle: 'Faixas avulsas de quem você já ouve',
    tracks,
  };
}

// ── AGENTE DAS LETRAS ───────────────────────────────────────────

/**
 * Palavras que não dizem nada sobre o assunto de uma música. Sem cortá-las, a
 * "semelhança por letra" viraria semelhança por português: toda música tem
 * "que", "não" e "você".
 */
const VAZIAS = new Set(
  (
    'a o e de da do em um uma que se por com no na os as dos das para pra pro me te se lhe eu voce ' +
    'você tu ele ela nos nós eles elas meu minha seu sua nao não sim mais menos muito ja já ai aí ' +
    'la lá aqui quando onde como porque mas ou ser estar ter ir vem vai foi e é sao são tem tudo ' +
    'nada isso esse essa este esta so só ate até bem the you and to my me it is in of i a'
  )
    .split(/\s+/)
    .filter(Boolean),
);

/** Palavras com peso do texto de uma letra. */
export function temasDaLetra(texto: string): Map<string, number> {
  const contagem = new Map<string, number>();
  const palavras = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/);
  for (const p of palavras) {
    if (p.length < 4 || VAZIAS.has(p)) continue;
    contagem.set(p, (contagem.get(p) ?? 0) + 1);
  }
  return contagem;
}

/** Quanto dois conjuntos de temas se sobrepõem (0..1). */
export function semelhancaDeTemas(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comuns = 0;
  const menor = a.size <= b.size ? a : b;
  const maior = menor === a ? b : a;
  for (const chave of menor.keys()) if (maior.has(chave)) comuns += 1;
  return comuns / menor.size;
}

/**
 * Recomenda pelo que as músicas FALAM.
 *
 * Nenhum outro agente olha para dentro da música: todos param no artista, no
 * gênero ou no relógio. Este pega o texto das letras que ele mais ouve, extrai
 * o vocabulário recorrente e procura, na biblioteca, faixas que falem das
 * mesmas coisas — mesmo de outro artista e outro gênero. É o caminho para
 * "gosto de música que fala de saudade", que nenhuma tag expressa.
 *
 * `letraDe` devolve o texto já em cache (nunca busca rede): recomendação não
 * pode depender de conexão nem fazer o usuário esperar.
 */
export function agenteDasLetras(
  inputs: AgenteInputs,
  letraDe: (trackId: string) => string | null,
): Prateleira | null {
  const { entries, history, liked } = inputs;

  // Perfil: temas das letras que ele mais ouviu (e curtiu).
  const referencia = unicas([...history.slice(0, 60).map((p) => p.track), ...liked]).slice(0, 40);
  const perfil = new Map<string, number>();
  let comLetra = 0;
  for (const t of referencia) {
    const texto = letraDe(t.id);
    if (!texto) continue;
    comLetra += 1;
    for (const [palavra, n] of temasDaLetra(texto)) {
      perfil.set(palavra, (perfil.get(palavra) ?? 0) + n);
    }
  }
  // Poucas letras conhecidas = perfil sem lastro; melhor não sugerir nada.
  if (comLetra < 3 || perfil.size < 10) return null;

  // Só o vocabulário mais forte — a cauda longa é ruído.
  const nucleo = new Map([...perfil.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60));

  const ouvidas = new Set(history.slice(0, 120).map((p) => p.track.id));
  const pontuadas: { track: TrackDto; score: number }[] = [];
  for (const e of entries) {
    if (ouvidas.has(e.track.id)) continue;
    const texto = letraDe(e.track.id);
    if (!texto) continue;
    const score = semelhancaDeTemas(nucleo, temasDaLetra(texto));
    if (score > 0.12) pontuadas.push({ track: e.track, score });
  }

  const tracks = pontuadas
    .sort((a, b) => b.score - a.score)
    .map((x) => x.track)
    .slice(0, TAMANHO);
  if (tracks.length < 4) return null;

  return {
    key: 'reco:letras',
    title: 'Fala do que você ouve',
    subtitle: 'Escolhidas pelo assunto das letras, não pelo artista',
    tracks,
  };
}

// ── o time inteiro ──────────────────────────────────────────────

/**
 * Roda todos os agentes e devolve as prateleiras que têm o que dizer.
 *
 * Agente sem sinal devolve `null` e some — melhor uma Home com três
 * prateleiras verdadeiras que seis, metade preenchida com o que sobrou.
 */
export function construirPrateleirasDeAgentes(
  inputs: AgenteInputs,
  letraDe: (trackId: string) => string | null,
): Prateleira[] {
  return [
    agenteDoRelogio(inputs),
    agenteDoCalendario(inputs),
    agenteDeSingles(inputs),
    agenteDasLetras(inputs, letraDe),
  ].filter((p): p is Prateleira => p !== null);
}

/**
 * Capas para o cartão: até 4 DISTINTAS, que viram colagem 2×2.
 *
 * Uma capa só fazia o mix parecer um álbum específico sem nada a ver com o
 * conteúdo — é o mesmo motivo pelo qual o motor antigo já monta colagem.
 */
export function capasDaPrateleira(tracks: readonly TrackDto[], max = 4): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    const capa = t.coverUrl;
    if (!capa || vistas.has(capa)) continue;
    vistas.add(capa);
    out.push(capa);
    if (out.length >= max) break;
  }
  return out;
}
