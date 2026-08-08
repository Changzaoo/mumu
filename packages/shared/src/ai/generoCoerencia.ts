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
  | 'genero-do-selo';

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
    const principal = faixa.artistas[0];
    if (!principal) continue;
    if (atual && GENEROS_DO_ARTISTA.has(atual)) continue; // já está no lugar

    const voto = generoDoArtista(depois, principal, faixa.id);
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
