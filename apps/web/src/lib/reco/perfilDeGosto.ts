/**
 * O PERFIL DE GOSTO — uma definição só de "o que esta pessoa gosta".
 *
 * Antes deste arquivo, "afinidade" era calculada em três lugares com três
 * fórmulas diferentes: `generosDoGosto.ts` (meia-vida de 30 dias, curtida ×2),
 * `faixasFavoritas.ts` (30 dias, ×3) e `recommend.ts` (14 dias, ×3). Nenhuma
 * errada sozinha — mas a Home ORDENAVA as prateleiras por uma e escrevia
 * "porque você ouve" por outra: duas respostas para a mesma pergunta na mesma
 * tela. As duas primeiras passaram a beber daqui, junto com as ramificações e
 * a ordem da Home.
 *
 * `recommend.ts` continua com a meia-vida curta dele, e isso é decisão, não
 * pendência: os mixes diários respondem "o que você está ouvindo ESTA semana",
 * uma pergunta diferente de "de que você gosta". Duas janelas de tempo para
 * duas perguntas é certo; duas para a mesma seria o defeito.
 *
 * ── O QUE O SPOTIFY FAZ, E O QUE DISSO CABE AQUI ──
 *
 * O sistema que ordena a Home do Spotify (BaRT — "Bandits for Recommendations
 * as Treatments", do artigo "Explore, Exploit, Explain", 2018) apoia-se em três
 * ideias que este arquivo reproduz, e uma que ele não tem como reproduzir:
 *
 *   1. SUCESSO É STREAM ACIMA DE 30s, não clique; pular antes disso é falha.
 *      Nós já obedecemos a esse limiar sem ter combinado: o player só grava no
 *      histórico aos 30s OU 50% da faixa (ver `playerStore`), então toda entrada
 *      do nosso histórico já é um sucesso pela régua deles. O que não temos é o
 *      lado negativo — o pulo não deixa rastro. Está escrito em `SINAL_QUE_FALTA`
 *      no fim do arquivo, em vez de fingido em alguma fórmula.
 *   2. ENGAJAMENTO É GRADUADO. Ouvir 30s de uma faixa de cinco minutos não é o
 *      mesmo que ouvi-la inteira. `playedMs / durationMs` dá essa graduação, e
 *      ela já está gravada em cada entrada do histórico.
 *   3. GOSTO É DE AGORA. Decaimento exponencial: esta semana pesa mais que dois
 *      meses atrás.
 *
 * O que NÃO cabe: filtragem colaborativa. Ela precisa do co-ouvir de milhões de
 * contas, e este motor roda inteiro no aparelho, sem mandar o gosto de ninguém
 * para lugar nenhum. O substituto honesto é o CONTEÚDO — família de gênero,
 * artista, e os vetores de `lib/reco/embeddings` quando existem.
 *
 * Puro e testável: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { familiaDoGenero, type FamiliaDeGenero } from '@radinho/shared';

/** Meia-vida do play: o de um mês atrás vale metade do de hoje. */
const MEIA_VIDA_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Quanto vale uma curtida, em plays.
 *
 * Ela é deliberada — a pessoa parou e apertou o coração — mas é um ato ÚNICO,
 * enquanto ouvir se repete. Três põe a curtida acima de qualquer play isolado e
 * abaixo de um hábito de verdade, que é a ordem certa: quem curtiu uma faixa de
 * jazz há um ano e ouve pagode todo dia gosta de pagode.
 */
export const PESO_CURTIDA = 3;

/**
 * O PISO DO ENGAJAMENTO, e por que ele não é zero.
 *
 * O peso de um play é `playedMs / durationMs` limitado a [PISO, 1]. Sem piso,
 * uma faixa de oito minutos ouvida pelos 30s da regra valeria 0,06 — quase
 * nada, quando na verdade a pessoa passou meio minuto ali por vontade própria.
 * E `durationMs` mente com frequência neste app: faixa importada sem duração
 * sondada chega zerada. O piso impede um dado ruim de virar "ela não gosta".
 */
const PISO_ENGAJAMENTO = 0.35;

/**
 * O PESO DA ESCOLHA DO ONBOARDING, E COMO ELE É ESQUECIDO.
 *
 * `PESO_SEMENTE` manda no dia zero: 6 fica acima de duas curtidas e muito acima
 * da base de tamanho do acervo — o suficiente para o que a pessoa escolheu
 * passar na frente do maior gênero da biblioteca, que é o problema do primeiro
 * dia. `MEIA_FORCA_SEMENTE` é a massa de comportamento real que corta esse peso
 * pela metade: ~10 equivale a uma dezena de plays recentes.
 *
 * É o que separa um PALPITE de uma CONFIGURAÇÃO: quem escolheu "rock" ao entrar
 * e passa um mês ouvindo samba vê samba, sem procurar tela de ajuste.
 */
const PESO_SEMENTE = 6;
const MEIA_FORCA_SEMENTE = 10;

/** Abaixo disto o gosto ainda não foi medido — vale a semente e o acervo. */
export const PLAYS_PARA_CONFIAR = 5;

export interface PlayObservado {
  track: TrackDto;
  playedAt?: string;
  /** Quanto da faixa foi ouvido. Ausente = tratado como o piso. */
  playedMs?: number;
}

export interface EntradasDoPerfil {
  historico: readonly PlayObservado[];
  curtidas: readonly TrackDto[];
  /** Gênero de cada faixa quando ela própria não traz (agrupamento da biblioteca). */
  generoDaFaixa?: ReadonlyMap<string, string>;
  /** O que a pessoa escolheu ao entrar (lib/local/gostoInicial). */
  sementesDeGenero?: readonly string[];
  sementesDeArtista?: readonly string[];
  now?: Date;
}

export interface PerfilDeGosto {
  /**
   * Afinidade por gênero, com a chave CANÔNICA (`chaveDeTexto`), não a grafia.
   *
   * Sem isto, "Gospel" escolhido no onboarding e "gospel" vindo do catálogo
   * seriam dois gêneros diferentes somando metade cada — e o gosto da pessoa
   * apareceria dividido ao meio por uma diferença de maiúscula. Use
   * `afinidadeDoGenero`, que normaliza; o rótulo bonito está em `nomeDoGenero`.
   */
  porGenero: ReadonlyMap<string, number>;
  /** Chave canônica → a grafia que a interface deve mostrar. */
  nomeDoGenero: ReadonlyMap<string, string>;
  /** Afinidade deste gênero, aceitando qualquer grafia (com a semente dentro). */
  afinidadeDoGenero: (genero: string) => number;
  /**
   * Afinidade MEDIDA — só comportamento, sem a escolha do onboarding.
   *
   * Existe separada porque a interface precisa distinguir "porque você ouve
   * bastante" de "você escolheu ao entrar". Sem essa separação o app diria à
   * pessoa que ela ouve muito de um gênero que ela nunca tocou — e essa é a
   * frase que faz alguém deixar de acreditar no resto da tela.
   */
  afinidadeMedida: (genero: string) => number;
  /** Fatia do gênero na afinidade MEDIDA, em [0,1]. */
  fatiaMedida: (genero: string) => number;
  /** Afinidade por família (Samba+Pagode+Axé somam). Ver `familiaDoGenero`. */
  porFamilia: ReadonlyMap<FamiliaDeGenero, number>;
  /** Afinidade por artista, com o nome normalizado como chave. */
  porArtista: ReadonlyMap<string, number>;
  /** Nome de exibição de cada artista (a chave é normalizada). */
  nomeDoArtista: ReadonlyMap<string, string>;
  /** Soma da afinidade de comportamento REAL — sem a semente. */
  massaDeSinal: number;
  /** Quantos plays sustentam este perfil. Abaixo de `PLAYS_PARA_CONFIAR`, é chute. */
  plays: number;
  /** O gênero de maior afinidade, ou `null` quando não há sinal nenhum. */
  generoTopo: string | null;
  familiaTopo: FamiliaDeGenero | null;
  /** Fatia do gênero na afinidade total, em [0,1]. Base do "porque você ouve". */
  fatiaDoGenero: (genero: string) => number;
}

/** Compara rótulos ignorando acento, caixa e pontuação. */
export function chaveDeTexto(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function somar(mapa: Map<string, number>, chave: string, valor: number): void {
  mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
}

/**
 * O peso de um play: recência × quanto da faixa foi realmente ouvido.
 *
 * Exportado porque `ramificacoes` precisa da MESMA régua para decidir o que é
 * "você mais ouve" dentro de um gênero — duas réguas dariam duas ordens para a
 * mesma pergunta na mesma tela.
 */
export function pesoDoPlay(play: PlayObservado, agoraMs: number): number {
  const quando = play.playedAt ? Date.parse(play.playedAt) : Number.NaN;
  // Data ilegível (ou do futuro, relógio torto) não descarta o play: ele
  // aconteceu. Só não ganha o bônus de recência.
  const idade = Number.isFinite(quando) ? Math.max(0, agoraMs - quando) : MEIA_VIDA_MS;
  const recencia = Math.pow(0.5, idade / MEIA_VIDA_MS);

  const duracao = play.track?.durationMs ?? 0;
  const ouvido = play.playedMs ?? 0;
  const bruto = duracao > 0 && ouvido > 0 ? ouvido / duracao : 1;
  const engajamento = Math.min(1, Math.max(PISO_ENGAJAMENTO, bruto));

  return recencia * engajamento;
}

export function perfilDeGosto(entradas: EntradasDoPerfil): PerfilDeGosto {
  const agora = (entradas.now ?? new Date()).getTime();
  const generoDaFaixa = entradas.generoDaFaixa ?? new Map<string, string>();

  const porGenero = new Map<string, number>();
  const porFamilia = new Map<FamiliaDeGenero, number>();
  const porArtista = new Map<string, number>();
  const nomeDoArtista = new Map<string, string>();

  const nomeDoGenero = new Map<string, string>();
  const creditarGenero = (genero: string, peso: number): void => {
    const chave = chaveDeTexto(genero);
    if (!chave) return;
    somar(porGenero, chave, peso);
    if (!nomeDoGenero.has(chave)) nomeDoGenero.set(chave, genero);
    const familia = familiaDoGenero(genero);
    if (familia) porFamilia.set(familia, (porFamilia.get(familia) ?? 0) + peso);
  };

  const creditar = (track: TrackDto, peso: number): void => {
    const genero = track.genre ?? generoDaFaixa.get(track.id) ?? null;
    if (genero) creditarGenero(genero, peso);
    // SÓ O ARTISTA PRINCIPAL. Creditar todo participante fazia o convidado de
    // uma faixa muito ouvida empatar com quem a pessoa realmente escuta — e ele
    // subia para a grade de atalhos sem nunca ter sido ouvido sozinho.
    const nome = track.artists?.[0]?.name;
    if (nome && nome !== 'Desconhecido') {
      const chave = chaveDeTexto(nome);
      if (chave) {
        somar(porArtista, chave, peso);
        if (!nomeDoArtista.has(chave)) nomeDoArtista.set(chave, nome);
      }
    }
  };

  let plays = 0;
  for (const play of entradas.historico) {
    if (!play.track?.id) continue;
    plays += 1;
    creditar(play.track, pesoDoPlay(play, agora));
  }
  for (const curtida of entradas.curtidas) {
    if (!curtida?.id) continue;
    creditar(curtida, PESO_CURTIDA);
  }

  const massaDeSinal = [...porGenero.values()].reduce((a, b) => a + b, 0);
  // Retrato do comportamento ANTES da semente entrar. É a única forma honesta
  // de responder depois "isto é hábito ou é o que ela declarou no começo?".
  const porGeneroMedido = new Map(porGenero);

  // A SEMENTE ENTRA DEPOIS, e a força dela é função do que já foi medido — é
  // assim que ela manda no dia zero e some sozinha depois. Ela NÃO entra em
  // `massaDeSinal`: aquilo é comportamento, isto é declaração.
  const forcaSemente = PESO_SEMENTE / (1 + massaDeSinal / MEIA_FORCA_SEMENTE);
  for (const semente of entradas.sementesDeGenero ?? []) {
    if (semente) creditarGenero(semente, forcaSemente);
  }
  for (const semente of entradas.sementesDeArtista ?? []) {
    const chave = chaveDeTexto(semente ?? '');
    if (!chave) continue;
    somar(porArtista, chave, forcaSemente);
    if (!nomeDoArtista.has(chave)) nomeDoArtista.set(chave, semente);
  }

  let generoTopo: string | null = null;
  let melhor = 0;
  for (const [chave, valor] of porGenero) {
    if (valor > melhor) {
      melhor = valor;
      generoTopo = nomeDoGenero.get(chave) ?? chave;
    }
  }
  let familiaTopo: FamiliaDeGenero | null = null;
  let melhorFamilia = 0;
  for (const [familia, valor] of porFamilia) {
    if (valor > melhorFamilia) {
      melhorFamilia = valor;
      familiaTopo = familia;
    }
  }

  const totalComSemente = [...porGenero.values()].reduce((a, b) => a + b, 0);
  const afinidadeDoGenero = (genero: string): number => porGenero.get(chaveDeTexto(genero)) ?? 0;
  const afinidadeMedida = (genero: string): number =>
    porGeneroMedido.get(chaveDeTexto(genero)) ?? 0;
  return {
    porGenero,
    nomeDoGenero,
    afinidadeDoGenero,
    afinidadeMedida,
    fatiaMedida: (genero: string) =>
      massaDeSinal > 0 ? afinidadeMedida(genero) / massaDeSinal : 0,
    porFamilia,
    porArtista,
    nomeDoArtista,
    massaDeSinal,
    plays,
    generoTopo,
    familiaTopo,
    fatiaDoGenero: (genero: string) =>
      totalComSemente > 0 ? afinidadeDoGenero(genero) / totalComSemente : 0,
  };
}

/**
 * SINAL_QUE_FALTA — o pulo.
 *
 * O Spotify conta como FALHA a faixa pulada antes dos 30s, e é metade do que
 * ensina o modelo dele: sem o lado negativo, um gênero só pode subir. Aqui o
 * pulo não deixa rastro — o player só chama `localHistory.record` quando o play
 * dá certo. Enquanto for assim, este perfil sabe do que a pessoa gosta e não
 * sabe do que ela foge, e nenhuma linha deste arquivo deve fingir que sabe.
 *
 * Fechar a lacuna significa gravar o abandono (faixa trocada antes dos 30s, com
 * o motivo) — mudança no `playerStore`, não aqui.
 */
export const SINAL_QUE_FALTA = 'pulo antes de 30s nao e registrado' as const;
