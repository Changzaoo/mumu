/**
 * O ARTISTA É A MELHOR PROVA DE GÊNERO QUE TEMOS DE GRAÇA.
 *
 * O relato foi: trap indo parar em Lo-Fi, e trap indo parar em Sertanejo. Os
 * dois erros têm a mesma forma — uma faixa isolada recebendo uma categoria que
 * NENHUMA outra faixa do mesmo artista tem. Um artista de trap com oito faixas
 * de trap e uma de sertanejo não é um artista eclético: é uma faixa classificada
 * errado, e dá para saber disso sem perguntar a ninguém.
 *
 * A classificação antiga tratava cada faixa como um evento independente: uma
 * pergunta ao modelo, uma resposta, gravou. Duzentas faixas eram duzentos
 * sorteios sem memória, e bastava um sair torto para a prateleira de sertanejo
 * ganhar um trap. Aqui a biblioteca passa a ter memória.
 *
 * Duas regras, e elas fazem coisas diferentes:
 *
 *  HERDAR  — o artista já tem gênero firme? A faixa nova nasce com ele, sem
 *            gastar uma consulta ao modelo. É o caso comum e o mais barato.
 *  VETAR   — o modelo respondeu algo que contradiz o artista inteiro? A resposta
 *            é recusada e a faixa fica sem categoria. Sem categoria é um buraco
 *            visível; categoria errada é uma mentira que ninguém revisa.
 *
 * Os limiares são propositalmente diferentes. Para HERDAR basta um sinal
 * razoável (2 faixas, 60%) — o custo de errar é baixo e corrigível. Para VETAR
 * a resposta de quem de fato ouviu a faixa é preciso um sinal FORTE (3 faixas,
 * 75%), senão um artista que muda de estilo nunca conseguiria uma categoria
 * nova. Vetar demais também é um defeito.
 *
 * Tudo aqui é função pura: recebe faixas, devolve decisões. Quem aplica é quem
 * tem as faixas na mão.
 *
 * Vive em `shared` porque os DOIS lados decidem gênero: o app, para o que acaba
 * de ser importado, e o worker de curadoria 24/7, que é quem varre a biblioteca
 * inteira e o acervo sem ninguém abrir nada. Duas cópias divergiriam, e a mesma
 * faixa receberia categorias diferentes conforme quem a processou — que é
 * exatamente o defeito que este arquivo existe para consertar.
 */
import { GENRE_TAXONOMY, type Genre } from './curation.js';
import { normalizarGenero } from './generos.js';

/* Quem consome este módulo já fala em `Genre` (é o tipo de tudo que ele devolve),
   então repassamos o tipo daqui em vez de obrigar cada chamador a saber que ele
   mora na taxonomia. Sem isto, `tsc --noEmit` quebra o pacote inteiro: o vitest
   apaga os tipos e não percebe, o build percebe. */
export type { Genre };

/** O mínimo que precisamos saber de uma faixa para decidir gênero. */
export interface FaixaMinima {
  id: string;
  genre: string | null;
  artistas: string[];
  /**
   * A fonte que publicou a faixa — selo ou canal. Sai do leitor de título, que
   * já decide se um nome como "MK MUSIC" é a gravadora (vira `label`) ou uma
   * pessoa (vira artista). Aqui ela vota no gênero: ver a 4ª passada.
   */
  label?: string | null;
}

export interface VotoDoArtista {
  /** O gênero mais comum entre as faixas já categorizadas deste artista. */
  dominante: Genre | null;
  /** Quantas faixas dele têm esse gênero. */
  votos: number;
  /** Quantas faixas dele têm ALGUM gênero válido. */
  total: number;
}

const VAZIO: VotoDoArtista = { dominante: null, votos: 0, total: 0 };

/** Herdar exige um sinal razoável; o erro aqui é barato e corrigível. */
const MIN_VOTOS_HERDAR = 2;
const MIN_FATIA_HERDAR = 0.6;
/** Vetar contraria quem ouviu a faixa: exige sinal forte. */
const MIN_VOTOS_VETAR = 3;
/**
 * Gêneros que descrevem o ARTISTA e não a faixa — ver a 3ª passada de
 * `revisarGeneros`. A lista é minúscula de propósito: só entra o que é
 * repertório inteiro de uma carreira, nunca uma escolha faixa a faixa.
 */
const GENEROS_DO_ARTISTA = new Set<Genre>(['Gospel']);
/** Barra da 3ª passada: duas faixas do artista já bastam. */
const MIN_VOTOS_ARTISTA = 2;
const MIN_FATIA_VETAR = 0.75;
/**
 * Barra da 4ª passada — o voto do selo. Mais alta que a do artista porque um
 * selo publica MUITO mais que um artista: quatro faixas e dois terços do
 * catálogo garantem que é um selo especializado (gospel, trap), não uma
 * gravadora grande que lança de tudo — essas nunca formam maioria e não votam.
 */
const MIN_VOTOS_SELO = 4;
const MIN_FATIA_SELO = 0.66;

function chaveArtista(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TAXONOMIA = new Set<string>(GENRE_TAXONOMY);

/** O gênero válido desta faixa, ou null (rótulo estranho não vota). */
function generoValido(faixa: FaixaMinima): Genre | null {
  const g = faixa.genre?.trim();
  if (!g) return null;
  return TAXONOMIA.has(g) ? (g as Genre) : null;
}

/**
 * Apura o gênero de um artista a partir das faixas dele que já têm categoria.
 *
 * A faixa em questão fica de fora (`exceto`) — senão ela votaria em si mesma e
 * o veto nunca dispararia contra o próprio erro que estamos procurando.
 */
export function generoDoArtista(
  faixas: readonly FaixaMinima[],
  artista: string,
  exceto?: string,
): VotoDoArtista {
  const alvo = chaveArtista(artista);
  if (!alvo) return VAZIO;

  const contagem = new Map<Genre, number>();
  let total = 0;
  for (const faixa of faixas) {
    if (faixa.id === exceto) continue;
    if (!faixa.artistas.some((a) => chaveArtista(a) === alvo)) continue;
    const g = generoValido(faixa);
    if (!g) continue;
    contagem.set(g, (contagem.get(g) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return VAZIO;

  let dominante: Genre | null = null;
  let votos = 0;
  for (const [g, n] of contagem) {
    if (n > votos) {
      dominante = g;
      votos = n;
    }
  }
  return { dominante, votos, total };
}

/**
 * Apura o gênero de um SELO a partir das faixas dele que já têm categoria.
 *
 * Mesma mecânica de `generoDoArtista`, com a fonte no lugar do artista. Existe
 * porque há um erro que o artista não alcança: quando a discografia INTEIRA de
 * um artista entrou torta (o Midian Lima com três faixas em Funk, Reggaeton e
 * Sertanejo), não há faixa certa dele para votar. Mas todas saíram do mesmo
 * selo gospel, e o catálogo do selo — dezenas de faixas de vários artistas — é
 * a prova que faltava. Um selo especializado é uma pista de gênero tão boa
 * quanto o artista, às vezes melhor, e é de graça.
 */
export function generoDoSelo(
  faixas: readonly FaixaMinima[],
  label: string,
  exceto?: string,
): VotoDoArtista {
  const alvo = chaveArtista(label);
  if (!alvo) return VAZIO;

  const contagem = new Map<Genre, number>();
  let total = 0;
  for (const faixa of faixas) {
    if (faixa.id === exceto) continue;
    if (!faixa.label || chaveArtista(faixa.label) !== alvo) continue;
    const g = generoValido(faixa);
    if (!g) continue;
    contagem.set(g, (contagem.get(g) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return VAZIO;

  let dominante: Genre | null = null;
  let votos = 0;
  for (const [g, n] of contagem) {
    if (n > votos) {
      dominante = g;
      votos = n;
    }
  }
  return { dominante, votos, total };
}

/**
 * O artista tem gênero firme o bastante para a faixa nova nascer com ele?
 *
 * Devolver um gênero aqui economiza uma consulta ao modelo E evita o sorteio
 * que produzia o trap solitário na prateleira de sertanejo.
 */
export function herdarDoArtista(voto: VotoDoArtista): Genre | null {
  if (!voto.dominante || voto.total === 0) return null;
  if (voto.votos < MIN_VOTOS_HERDAR) return null;
  if (voto.votos / voto.total < MIN_FATIA_HERDAR) return null;
  return voto.dominante;
}

/**
 * Filtra a resposta do modelo contra o que o artista inteiro diz.
 *
 * Devolve o gênero a gravar, ou `null` para não gravar nada. O veto só acontece
 * com maioria forte: contrariar quem de fato ouviu a faixa precisa de prova.
 */
export function aceitarSugestao(sugestao: string | null, voto: VotoDoArtista): Genre | null {
  const limpa = normalizarGenero(sugestao);
  if (!limpa) return null;
  if (!voto.dominante || limpa === voto.dominante) return limpa;
  if (voto.votos >= MIN_VOTOS_VETAR && voto.votos / voto.total >= MIN_FATIA_VETAR) {
    return null; // contradiz o artista inteiro: prefiro deixar sem categoria
  }
  return limpa;
}

// ── revisão do que já está gravado ────────────────────────────────────────
//
// As correções acima só valem para o que vier daqui em diante. A biblioteca já
// está cheia de gênero errado gravado pelo sistema antigo — e como o agente só
// procura faixa SEM categoria, nada disso seria reexaminado um dia sequer.

export type MotivoDaRevisao =
  /** Rótulo que não é gênero ("Brasileira") — sai, e a faixa volta para a fila. */
  | 'balde'
  /** Mesmo gênero escrito de outro jeito ("eletronica" → "Eletrônica"). */
  | 'normalizado'
  /** Destoa de todo o resto do artista — quase sempre é o erro que procuramos. */
  | 'discrepante'
  /**
   * O gênero é do ARTISTA, não da faixa (Gospel). Barra mais baixa que
   * `discrepante` porque cantor de louvor não tem faixa sertaneja no meio do
   * repertório — ver a 3ª passada de `revisarGeneros`.
   */
  | 'genero-do-artista'
  /**
   * O gênero veio da FONTE — o selo/canal que publicou. Alcança o que o artista
   * não alcança: uma discografia inteira que entrou torta, mas de um selo
   * especializado cujo catálogo prova o gênero. Ver a 4ª passada.
   */
  | 'genero-do-selo'
  /**
   * O GÊNERO REAL DO ARTISTA, descoberto por evidência EXTERNA (IA/catálogo)
   * quando a discografia se espalhou sem maioria e não há voto interno confiável
   * para consertar — o caso do Alee (trap) esparramado por dez gêneros, nenhum
   * chegando a 28%. Ver `forcarGeneroReal`.
   */
  | 'genero-real-do-artista';

export interface RevisaoDeGenero {
  id: string;
  de: string | null;
  para: Genre | null;
  motivo: MotivoDaRevisao;
}

/**
 * Compara o que está gravado com o que a biblioteca inteira indica.
 *
 * Função pura: devolve a lista de mudanças, não aplica nenhuma. Quem aplica
 * controla o ritmo — uma rajada de patches vira uma rajada de escritas na nuvem,
 * e já derrubamos a cota do projeto assim uma vez.
 */
export function revisarGeneros(faixas: readonly FaixaMinima[]): RevisaoDeGenero[] {
  // UMA MUDANÇA POR FAIXA, e não uma por passada.
  //
  // As três passadas podiam falar da mesma faixa: um rótulo torto que também
  // destoa do artista ("sertaneja" numa discografia gospel) saía daqui como
  // DUAS revisões do mesmo id — "sertaneja → Sertanejo" e "Sertanejo → Gospel".
  // Quem aplica escreve as duas, o que é o dobro de escritas na nuvem (já
  // derrubamos a cota assim) e, dependendo da ordem, grava a primeira por cima
  // da segunda e deixa a faixa no lugar errado de novo.
  //
  // O `de` que vale é sempre o que está gravado HOJE — é ele que quem aplica
  // usa para conferir se alguém mexeu no meio do caminho.
  const mudancas = new Map<string, RevisaoDeGenero>();
  const registrar = (
    id: string,
    de: string | null,
    para: Genre | null,
    motivo: MotivoDaRevisao,
  ): void => {
    mudancas.set(id, { id, de: mudancas.get(id)?.de ?? de, para, motivo });
  };

  // 1ª passada: traduzir o que dá e esvaziar os baldes. Precisa vir antes da
  // apuração por artista — senão "Brasileira" contaria como voto.
  const depois: FaixaMinima[] = faixas.map((faixa) => {
    const atual = faixa.genre?.trim() || null;
    if (!atual) return faixa;
    const normalizado = normalizarGenero(atual);
    if (normalizado === atual) return faixa;
    registrar(faixa.id, atual, normalizado, normalizado ? 'normalizado' : 'balde');
    return { ...faixa, genre: normalizado };
  });

  // 2ª passada: o outlier do artista. É aqui que o trap solitário na prateleira
  // de sertanejo é reconhecido e devolvido ao lugar dele — sem gastar uma
  // consulta ao modelo, porque a prova já está na biblioteca.
  for (const faixa of depois) {
    const atual = generoValido(faixa);
    if (!atual) continue;
    const principal = faixa.artistas[0];
    if (!principal) continue;
    const voto = generoDoArtista(depois, principal, faixa.id);
    if (!voto.dominante || voto.dominante === atual) continue;
    if (voto.votos < MIN_VOTOS_VETAR || voto.votos / voto.total < MIN_FATIA_VETAR) continue;
    // GÊNERO DE ARTISTA NÃO SAI POR MAIORIA — e sem esta linha a maioria era a
    // arma do erro, não a defesa contra ele.
    //
    // A fonte erra sempre na mesma direção: gospel brasileiro entra como
    // sertanejo, forró ou trap. Num artista com 2 faixas em Gospel e 3 em
    // Sertanejo — o retrato de um cantor de louvor mal importado —, o sertanejo
    // era a maioria e esta passada convertia as DUAS faixas certas para
    // Sertanejo, cimentando o erro e esvaziando a prateleira Gospel de vez. A
    // 3ª passada existe para puxar na direção contrária; deixar esta empurrar
    // de volta é as duas brigando na mesma volta.
    if (GENEROS_DO_ARTISTA.has(atual) && !GENEROS_DO_ARTISTA.has(voto.dominante)) continue;
    registrar(faixa.id, atual, voto.dominante, 'discrepante');
  }

  // 3ª passada: OS GÊNEROS QUE SÃO DO ARTISTA, NÃO DA FAIXA.
  //
  // A passada acima exige 3 votos e 75% — números feitos para discografia
  // grande, e certos para o caso comum: um artista de pop PODE ter uma faixa de
  // rock, então mexer precisa de prova forte.
  //
  // Gospel não funciona assim. Cantor de louvor não tem uma faixa sertaneja no
  // meio do repertório: o gênero é uma propriedade DELE, não de cada música. E
  // como a batida do gospel brasileiro imita sertanejo, forró e trap, a fonte
  // erra sempre na mesma direção — e o modelo, que não conhece a faixa, responde
  // "incerto" e deixa como está.
  //
  // Medido na biblioteca: "Raridade" (Anderson Freire) em Sertanejo com outras
  // DUAS faixas dele em Gospel; "Sobrevivi" (Sarah Farias) igual. Pela regra
  // acima, 2 votos nunca alcançam os 3 exigidos e as duas ficariam erradas para
  // sempre — foi exatamente o que aconteceu.
  //
  // Aqui a barra é 2 votos e maioria simples, e SÓ para os gêneros de artista.
  // O risco assimétrico ajuda: uma faixa gospel a mais na prateleira de gospel
  // não incomoda ninguém; uma faixa de louvor perdida no sertanejo é o que fez
  // o dono do app passar vergonha.
  for (const faixa of depois) {
    const atual = generoValido(faixa);
    if (faixa.artistas.length === 0) continue;
    if (atual && GENEROS_DO_ARTISTA.has(atual)) continue; // já está no lugar

    // VALE QUALQUER ARTISTA CREDITADO, não só o principal.
    //
    // "Ninguém Explica Deus" tem o Preto no Branco como principal — uma só faixa
    // gospel na biblioteca, não alcança os dois votos — e a Gabriela Rocha como
    // convidada, com seis faixas, todas gospel. É a convidada que prova o
    // gênero. Um gênero de carreira como Gospel se herda de quem PARTICIPA, não
    // só de quem encabeça: quem divide o microfone numa música de louvor está
    // cantando louvor. Fico com o voto gospel mais forte entre os creditados.
    let voto = VAZIO;
    for (const artista of faixa.artistas) {
      const v = generoDoArtista(depois, artista, faixa.id);
      if (v.dominante && GENEROS_DO_ARTISTA.has(v.dominante) && v.votos > voto.votos) voto = v;
    }
    if (!voto.dominante || !GENEROS_DO_ARTISTA.has(voto.dominante)) continue;
    if (voto.votos < MIN_VOTOS_ARTISTA) continue;
    // A FAIXA EM JULGAMENTO CONTA COMO VOTO CONTRA — `+ 1` no denominador.
    //
    // A apuração exclui a própria faixa para ela não votar em si mesma, e isso
    // estava virando uma balança viciada: num artista com 2 Gospel e 2 de outra
    // coisa, tirar a faixa em questão deixava 2 contra 1, "maioria" folgada, e
    // as DUAS faixas do outro gênero eram convertidas uma a uma — cada uma
    // sozinha contra as gospel. Com 3 e 3 acontecia igual: o repertório inteiro
    // de um artista misto virava Gospel.
    //
    // Contando a faixa julgada do lado dela, o empate volta a ser empate e a
    // conversão só acontece quando o Gospel é maioria de verdade. O caso que
    // motivou a passada continua passando: 2 Gospel + "Raridade" em Sertanejo
    // são 2 de 3.
    if (voto.votos / (voto.total + 1) <= 0.5) continue;
    // A 2ª passada já decidiu esta faixa olhando a mesma discografia.
    if (mudancas.get(faixa.id)?.motivo === 'discrepante') continue;

    registrar(faixa.id, atual, voto.dominante, 'genero-do-artista');
  }

  // 4ª passada: O GÊNERO QUE VEM DA FONTE — o selo/canal que publicou.
  //
  // A 3ª passada precisa de UMA faixa certa do artista para votar. Quando a
  // discografia inteira entrou torta, não há voto nenhum: o Midian Lima tem três
  // faixas e as três estão erradas (Funk, Reggaeton, Sertanejo) — nenhuma para
  // puxar as outras. Mas todas saíram do MK Music, e o catálogo do selo —
  // dezenas de faixas de artistas diferentes, majoritariamente gospel — é a
  // prova que o artista sozinho não tinha.
  //
  // Fecha com a 3ª de um jeito que importa: assim que o selo põe DUAS faixas do
  // Midian Lima em Gospel, ele passa a ter discografia gospel, e na volta
  // seguinte a 3ª passada puxa a terceira sozinha. Um conserto destrava o outro.
  //
  // A barra é alta de propósito (4 votos, dois terços) para separar selo
  // especializado de gravadora grande: MK Music é gospel puro e vota; Universal,
  // que lança de tudo, nunca forma maioria e fica de fora.
  for (const faixa of depois) {
    const label = faixa.label?.trim();
    if (!label) continue;
    if (mudancas.has(faixa.id)) continue; // uma revisão por volta

    const atual = generoValido(faixa);
    const voto = generoDoSelo(depois, label, faixa.id);
    if (!voto.dominante || voto.dominante === atual) continue;
    if (voto.votos < MIN_VOTOS_SELO) continue;
    if (voto.votos / voto.total < MIN_FATIA_SELO) continue;

    registrar(faixa.id, atual, voto.dominante, 'genero-do-selo');
  }

  return [...mudancas.values()];
}

// ── O GÊNERO REAL DO ARTISTA — quando a atribuição por faixa se espalhou toda ──
//
// O caso que motivou tudo isto foi medido em produção: o Alee tem 78 faixas no
// acervo, e elas estão em DEZ gêneros — Sertanejo 22, Pop 20, Hip-Hop 11,
// Trap 9, Funk 5, Indie 4, Forró 3, Eletrônica 2, MPB 2, Lo-Fi 1. Nenhum passa
// de 28%. Alee é um artista de TRAP; Sertanejo, Pop e Forró são erro puro.
//
// As passadas de `revisarGeneros` não alcançam este defeito, e é importante
// entender por quê: elas apuram o gênero DENTRO da própria biblioteca. Quando a
// atribuição por faixa acerta na maioria e erra num punhado, a discografia
// aponta o certo e o outlier é devolvido (`discrepante`). Mas quando a
// atribuição erra de forma ESPALHADA — um sorteio diferente por faixa —, a
// própria discografia é o ruído: não há maioria para votar, e o dominante
// (Sertanejo, com 28%) está tão errado quanto o resto. A prova não está DENTRO
// da biblioteca; ela é EXTERNA — quem é o Alee, na vida real.
//
// O mecanismo em quatro linhas:
//   1. `artistasEspalhados` acha o artista cuja discografia está espalhada e sem
//      maioria forte (≥6 faixas, ≥3 gêneros, dominante < 75%) — o sintoma de que
//      a atribuição por faixa falhou, e NÃO de ecletismo comum.
//   2. Quem tem a evidência externa (o worker) pergunta à IA/catálogo o gênero
//      PRINCIPAL desse artista — uma resposta que pode ser ECLÉTICO ou
//      DESCONHECIDO, e nesses casos NÃO há veredicto.
//   3. `forcarGeneroReal` puxa TODAS as faixas do artista para o gênero do
//      veredicto.
//   4. As guardas contra achatar um artista genuinamente eclético estão em
//      `forcarGeneroReal`, cada uma comentada onde age.
//
// A descoberta é DERIVADA, não uma lista chumbada: o veredicto entra por
// argumento, apurado por quem tem rede na mão. Aqui tudo continua função pura.

/** Discografia precisa de tamanho para o espalhamento não ser azar de amostra. */
const MIN_FAIXAS_ESPALHADO = 6;
/** Espalhamento de verdade cobre vários gêneros; 2 gêneros é escolha, não ruído. */
const MIN_GENEROS_ESPALHADO = 3;
/**
 * Acima desta fatia a discografia JÁ é coerente e um outlier solto é trabalho da
 * 2ª passada (`discrepante`, que exige 75%). Só entra aqui o miolo bagunçado —
 * da ausência de maioria (Alee, 28%) à maioria fraca que a 2ª passada não
 * alcança (Brandão85, 58%, medido em produção).
 */
const MAX_FATIA_ESPALHADO = 0.75;
/**
 * Abaixo desta fatia a discografia não aponta NADA de confiável — é o ruído puro
 * do Alee, 28% no dominante já errado. Só nesse vazio o veredicto externo decide
 * sozinho, inclusive contra o dominante interno. Ver a guarda 3.
 */
const LIMIAR_SEM_SINAL_INTERNO = 0.35;

export interface ArtistaEspalhado {
  /** Nome do artista principal, como aparece na biblioteca (primeiro visto). */
  artista: string;
  /** Faixas dele COM gênero válido. */
  total: number;
  /** Quantos gêneros distintos essas faixas ocupam. */
  distintos: number;
  /** O gênero mais comum entre elas (pode ser o próprio erro dominante). */
  dominante: Genre | null;
  /** Fatia do dominante — quão longe de uma maioria a discografia está. */
  fatiaDominante: number;
}

interface AcumuladoArtista {
  nome: string;
  contagem: Map<Genre, number>;
  total: number;
}

/** Agrupa as faixas categorizadas pelo artista PRINCIPAL (`artistas[0]`). */
function agruparPorPrincipal(faixas: readonly FaixaMinima[]): Map<string, AcumuladoArtista> {
  const mapa = new Map<string, AcumuladoArtista>();
  for (const faixa of faixas) {
    const principal = faixa.artistas[0];
    if (!principal) continue;
    const chave = chaveArtista(principal);
    if (!chave) continue;
    const g = generoValido(faixa);
    if (!g) continue;
    let acc = mapa.get(chave);
    if (!acc) {
      acc = { nome: principal, contagem: new Map(), total: 0 };
      mapa.set(chave, acc);
    }
    acc.contagem.set(g, (acc.contagem.get(g) ?? 0) + 1);
    acc.total += 1;
  }
  return mapa;
}

function resumir(acc: AcumuladoArtista): ArtistaEspalhado {
  let dominante: Genre | null = null;
  let votos = 0;
  for (const [g, n] of acc.contagem) {
    if (n > votos) {
      dominante = g;
      votos = n;
    }
  }
  return {
    artista: acc.nome,
    total: acc.total,
    distintos: acc.contagem.size,
    dominante,
    fatiaDominante: acc.total ? votos / acc.total : 0,
  };
}

/** O acumulado tem a cara de uma discografia espalhada (candidata a veredicto)? */
function estaEspalhado(acc: AcumuladoArtista): boolean {
  if (acc.total < MIN_FAIXAS_ESPALHADO) return false;
  if (acc.contagem.size < MIN_GENEROS_ESPALHADO) return false;
  return resumir(acc).fatiaDominante < MAX_FATIA_ESPALHADO;
}

/**
 * Os artistas cuja discografia está espalhada demais para a atribuição por faixa
 * ser confiável — a lista de quem VALE perguntar a uma evidência externa.
 *
 * Função pura de leitura: não muda nada, só aponta os candidatos. Quem tem rede
 * (o worker) pega esta lista, pergunta à IA/catálogo, e devolve o veredicto para
 * `forcarGeneroReal`. Ordenado do mais espalhado para o menos — quem tem menos
 * maioria é o erro mais gritante e deve ser resolvido primeiro quando a cota
 * raciona quantas perguntas cabem por volta.
 */
export function artistasEspalhados(faixas: readonly FaixaMinima[]): ArtistaEspalhado[] {
  const out: ArtistaEspalhado[] = [];
  for (const acc of agruparPorPrincipal(faixas).values()) {
    if (!estaEspalhado(acc)) continue;
    out.push(resumir(acc));
  }
  out.sort((a, b) => a.fatiaDominante - b.fatiaDominante || b.total - a.total);
  return out;
}

/**
 * Aplica o gênero REAL de cada artista às faixas dele — com as guardas contra
 * achatar quem é eclético de verdade.
 *
 * `veredicto` mapeia NOME de artista → gênero confiante, apurado por fora (IA que
 * respondeu um gênero certo, não ECLÉTICO nem DESCONHECIDO; ou catálogo). A
 * chave é o nome cru — normalizamos os dois lados aqui, para o worker não
 * precisar conhecer a forma interna.
 *
 * Devolve a lista de revisões (função pura); quem aplica controla o ritmo, como
 * em `revisarGeneros`.
 */
export function forcarGeneroReal(
  faixas: readonly FaixaMinima[],
  veredicto: ReadonlyMap<string, Genre>,
): RevisaoDeGenero[] {
  if (veredicto.size === 0) return [];

  // Normaliza as chaves do veredicto uma vez.
  const porChave = new Map<string, Genre>();
  for (const [nome, g] of veredicto) {
    const chave = chaveArtista(nome);
    if (chave) porChave.set(chave, g);
  }

  const grupos = agruparPorPrincipal(faixas);
  // Decide, por artista, se o veredicto pode agir — e qual gênero aplicar.
  const forcar = new Map<string, Genre>();
  for (const [chave, acc] of grupos) {
    const alvo = porChave.get(chave);
    if (!alvo) continue;

    // GUARDA 1 — SÓ EM DISCOGRAFIA ESPALHADA. Um artista coerente com veredicto
    // não é achatado: se a atribuição por faixa está funcionando (maioria forte),
    // não há erro para consertar, e forçar seria criar um. Um "pop que fez um
    // rock" tem 90% Pop e 2 gêneros — nem chega aqui.
    if (!estaEspalhado(acc)) continue;

    // GUARDA 2 — O GÊNERO FORÇADO PRECISA JÁ EXISTIR NA DISCOGRAFIA. Sem isto,
    // uma resposta alucinada do modelo ("Alee é Jazz") inventaria um gênero que
    // o artista nunca tocou. Consolidar um sinal que já está lá é seguro;
    // introduzir um sinal do nada, não.
    if (!acc.contagem.has(alvo)) continue;

    // GUARDA 3 — VEREDICTO QUE CONTRARIA UMA MAIORIA INTERNA RAZOÁVEL É RECUSADO.
    // Quando a própria discografia aponta um dominante com algum peso (≥35%) e o
    // modelo aponta OUTRO gênero, é mais provável que o modelo se enganou sobre o
    // artista do que a discografia inteira. Só no vazio de sinal (o Alee, 28% num
    // dominante já errado) o veredicto externo decide sozinho contra o dominante.
    // Se o veredicto CONCORDA com o dominante (Brandão85, trap em 58%), ele age
    // sempre — aí não há contradição, só a limpeza da minoria espalhada.
    const r = resumir(acc);
    if (alvo !== r.dominante && r.fatiaDominante >= LIMIAR_SEM_SINAL_INTERNO) continue;

    forcar.set(chave, alvo);
  }

  const mudancas: RevisaoDeGenero[] = [];
  for (const faixa of faixas) {
    const principal = faixa.artistas[0];
    if (!principal) continue;
    const alvo = forcar.get(chaveArtista(principal));
    if (!alvo) continue;
    const atual = faixa.genre?.trim() || null;
    if (atual === alvo) continue;
    mudancas.push({ id: faixa.id, de: atual, para: alvo, motivo: 'genero-real-do-artista' });
  }
  return mudancas;
}
