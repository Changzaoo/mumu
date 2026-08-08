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
  | 'genero-do-artista';

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
  const mudancas: RevisaoDeGenero[] = [];

  // 1ª passada: traduzir o que dá e esvaziar os baldes. Precisa vir antes da
  // apuração por artista — senão "Brasileira" contaria como voto.
  const depois: FaixaMinima[] = faixas.map((faixa) => {
    const atual = faixa.genre?.trim() || null;
    if (!atual) return faixa;
    const normalizado = normalizarGenero(atual);
    if (normalizado === atual) return faixa;
    mudancas.push({
      id: faixa.id,
      de: atual,
      para: normalizado,
      motivo: normalizado ? 'normalizado' : 'balde',
    });
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
    mudancas.push({ id: faixa.id, de: atual, para: voto.dominante, motivo: 'discrepante' });
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
    if (voto.votos / voto.total <= 0.5) continue;
    if (mudancas.some((m) => m.id === faixa.id)) continue; // a passada acima já resolveu

    mudancas.push({
      id: faixa.id,
      de: atual,
      para: voto.dominante,
      motivo: 'genero-do-artista',
    });
  }

  return mudancas;
}
