/**
 * O NOSSO SISTEMA DE CONTEÚDO EXPLÍCITO — porque não havia nenhum.
 *
 * O campo `explicit` existia no tipo da faixa e estava escrito `false` na mão
 * em quase todo lugar do código. Só o mapeamento da Apple Music preenchia de
 * verdade, e o acervo local — a maior parte das faixas — nunca passa por lá.
 * Na prática o app afirmava, para milhares de músicas, que nenhuma tinha
 * palavrão. Uma afirmação que ele não tinha como fazer.
 *
 * Isso não é um detalhe de metadado. É o que separa "recomendou uma música que
 * você não curtiu" de "colocou funk com palavrão e apologia a droga na fila de
 * quem só ouve louvor". A primeira a pessoa perdoa; a segunda ela não perdoa, e
 * conta para os outros.
 *
 * ── AS TRÊS RESPOSTAS, E POR QUE SÃO TRÊS ──
 *
 * `explicito` | `limpo` | `desconhecido`.
 *
 * A terceira é a que faz o sistema ser honesto. Sem letra, não dá para saber —
 * e "não sei" NÃO É "está limpo". Tratar ausência de prova como prova de
 * inocência é exatamente como um filtro de conteúdo falha na cara de quem
 * confiou nele. Quem consome esta classificação decide o que fazer com o
 * desconhecido; para as famílias sensíveis, a regra é deixar de fora.
 *
 * ── DE ONDE VEM A EVIDÊNCIA ──
 *
 * Da LETRA, que o app já busca e guarda para o karaokê, e do TÍTULO. Não
 * dependemos de nenhum selo de terceiro dizendo o que é explícito: o léxico e
 * as regras abaixo são nossos, versionados aqui, e podem ser corrigidos quando
 * errarem — o que um selo opaco de loja não permite.
 *
 * ── O RISCO REAL DE UM CLASSIFICADOR POR PALAVRAS ──
 *
 * Não é deixar passar. É ACUSAR ERRADO. Um léxico ingênuo marca "Coca-Cola"
 * como cocaína, "baseado em uma história" como maconha, e — o pior de todos
 * neste app — marca "sangue de Jesus" como violência e reprova o repertório
 * gospel inteiro usando a ferramenta feita para protegê-lo.
 *
 * Por isso, três defesas:
 *
 *   1. Palavra ambígua não entra sozinha no léxico. Ou entra como EXPRESSÃO
 *      ("lança perfume", "boca de fumo"), ou entra como LEVE, que precisa de
 *      companhia para condenar, ou não entra. `pó`, `bala`, `erva`, `seda`,
 *      `coca`, `pau` e `rola` estão fora de propósito: o custo do falso
 *      positivo é maior que o do falso negativo.
 *   2. Violência NUNCA condena sozinha. "Sangue", "guerra" e "morte" são o
 *      vocabulário cotidiano de hino religioso e de sertanejo sofrência.
 *   3. Guardas de contexto para os casos conhecidos (ver `GUARDAS`).
 */

/** As famílias de conteúdo que sabemos reconhecer. */
export type CategoriaDeConteudo = 'palavrao' | 'drogas' | 'sexo' | 'violencia';

export type VeredictoDeConteudo = 'explicito' | 'limpo' | 'desconhecido';

export interface AnaliseDeConteudo {
  veredicto: VeredictoDeConteudo;
  categorias: CategoriaDeConteudo[];
  /** Os termos que dispararam — para poder auditar e corrigir o léxico. */
  achados: string[];
}

interface Termo {
  /** Já normalizado (sem acento, minúsculo). */
  termo: string;
  categoria: CategoriaDeConteudo;
  /**
   * `forte` condena sozinho. `leve` precisa de outro achado — é o grau de
   * quem é quase sempre explícito, mas tem uso inocente conhecido.
   */
  peso: 'forte' | 'leve';
}

const f = (termo: string, categoria: CategoriaDeConteudo): Termo => ({
  termo,
  categoria,
  peso: 'forte',
});
const l = (termo: string, categoria: CategoriaDeConteudo): Termo => ({
  termo,
  categoria,
  peso: 'leve',
});

/**
 * O LÉXICO.
 *
 * Escrito sem acento porque a análise roda sobre texto normalizado. Expressões
 * de várias palavras são preferidas sempre que a palavra sozinha for ambígua —
 * é a diferença entre reconhecer droga e reconhecer farinha de trigo.
 */
const LEXICO: readonly Termo[] = [
  // ── palavrão, português ───────────────────────────────────────────────
  f('caralho', 'palavrao'),
  f('porra', 'palavrao'),
  f('buceta', 'palavrao'),
  f('boceta', 'palavrao'),
  f('foda', 'palavrao'),
  f('fodase', 'palavrao'),
  f('foder', 'palavrao'),
  f('fodido', 'palavrao'),
  f('fudido', 'palavrao'),
  f('puta', 'palavrao'),
  f('putas', 'palavrao'),
  f('putaria', 'palavrao'),
  f('filho da puta', 'palavrao'),
  f('fdp', 'palavrao'),
  f('arrombado', 'palavrao'),
  f('vagabunda', 'palavrao'),
  f('cuzao', 'palavrao'),
  f('viado', 'palavrao'),
  f('xoxota', 'palavrao'),
  f('xereca', 'palavrao'),
  f('pepeka', 'palavrao'),
  f('punheta', 'palavrao'),
  f('boquete', 'palavrao'),
  f('krl', 'palavrao'),
  f('vsf', 'palavrao'),
  // Leves: xingamento de baixo calão que aparece em fala comum e em música
  // infantil ("que merda", "seu bosta"). Sozinhos não condenam.
  l('merda', 'palavrao'),
  l('bosta', 'palavrao'),
  l('corno', 'palavrao'),
  l('safada', 'palavrao'),
  l('desgraca', 'palavrao'),

  // ── palavrão, inglês ──────────────────────────────────────────────────
  f('fuck', 'palavrao'),
  f('fucking', 'palavrao'),
  f('motherfucker', 'palavrao'),
  f('bitch', 'palavrao'),
  f('pussy', 'palavrao'),
  f('cunt', 'palavrao'),
  f('nigga', 'palavrao'),
  f('whore', 'palavrao'),
  f('asshole', 'palavrao'),
  l('shit', 'palavrao'),
  l('damn', 'palavrao'),

  // ── drogas ────────────────────────────────────────────────────────────
  // Só o que não tem uso inocente, ou expressões inteiras. `po`, `bala`,
  // `erva`, `seda`, `coca` e `seda` estão FORA: o custo de errar é alto.
  f('cocaina', 'drogas'),
  f('maconha', 'drogas'),
  f('haxixe', 'drogas'),
  f('crack', 'drogas'),
  f('lanca perfume', 'drogas'),
  f('boca de fumo', 'drogas'),
  f('traficante', 'drogas'),
  f('trafico', 'drogas'),
  f('cracolandia', 'drogas'),
  f('ecstasy', 'drogas'),
  f('lsd', 'drogas'),
  f('metanfetamina', 'drogas'),
  f('cheirar po', 'drogas'),
  f('po branco', 'drogas'),
  l('beck', 'drogas'),
  l('baseado', 'drogas'),
  l('skunk', 'drogas'),
  l('weed', 'drogas'),
  l('blunt', 'drogas'),

  // ── sexo explícito ────────────────────────────────────────────────────
  f('sentando na', 'sexo'),
  f('gemendo', 'sexo'),
  f('quatro apoios', 'sexo'),
  f('surubao', 'sexo'),
  f('suruba', 'sexo'),
  l('transando', 'sexo'),
  l('gostosa', 'sexo'),
  l('rebolando', 'sexo'),

  // ── violência ─────────────────────────────────────────────────────────
  // TUDO leve, sem exceção. Ver a defesa nº 2 do cabeçalho: "sangue" e
  // "guerra" são o vocabulário de hino religioso, e "morrer de amor" é
  // metade do sertanejo. Violência aqui só corrobora; nunca condena.
  l('fuzil', 'violencia'),
  l('pistola', 'violencia'),
  l('revolver', 'violencia'),
  l('metralhadora', 'violencia'),
  l('bala perdida', 'violencia'),
];

/**
 * GUARDAS DE CONTEXTO — os falsos positivos que a gente JÁ conhece.
 *
 * Cada entrada é um termo do léxico e os vizinhos que provam inocência. É uma
 * lista curta de propósito: guarda demais vira um segundo classificador para
 * manter em dia. Ela cresce quando um erro real aparecer, não por precaução.
 */
const GUARDAS: ReadonlyArray<{ termo: string; inocenteSeSeguidoDe: readonly string[] }> = [
  // "baseado em fatos reais", "baseado na bíblia" — o uso mais comum da
  // palavra em português não tem nada a ver com droga.
  { termo: 'baseado', inocenteSeSeguidoDe: ['em', 'na', 'no', 'nas', 'nos', 'nisso'] },
];

/**
 * NORMALIZAÇÃO — tira acento, caixa, e desfaz os disfarces mais comuns.
 *
 * Letra de música escapa de filtro há décadas: `p0rra`, `c@ralho`, `fudeu`
 * virando `fudeeeeu`. Sem desfazer isso, o classificador só pega quem não
 * estava tentando escapar.
 *
 * O colapso de repetição só age em 3 ou mais letras iguais: reduzir duas
 * quebraria `passar`, `nossa`, `terra` — palavras onde a letra dobrada é a
 * grafia correta.
 */
export function normalizarParaAnalise(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0@$]/g, (c) => ({ '0': 'o', '@': 'a', $: 's' })[c] ?? c)
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Achou o termo como PALAVRA, não como pedaço de outra palavra. */
function contem(texto: string, termo: string): boolean {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escapado}($|\\s)`).test(texto);
}

function passouNaGuarda(texto: string, termo: string): boolean {
  const guarda = GUARDAS.find((g) => g.termo === termo);
  if (!guarda) return true;
  // Inocente quando TODA ocorrência vem seguida de um vizinho inofensivo.
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const todas = [...texto.matchAll(new RegExp(`(^|\\s)${escapado}\\s+(\\S+)`, 'g'))];
  if (todas.length === 0) return true;
  return todas.some((m) => !guarda.inocenteSeSeguidoDe.includes(m[2] ?? ''));
}

/**
 * Classifica um texto qualquer (letra, título).
 *
 * Texto vazio devolve `desconhecido`, nunca `limpo` — ver as três respostas no
 * cabeçalho. É a diferença entre um filtro honesto e um que mente por omissão.
 */
export function classificarTexto(texto: string | null | undefined): AnaliseDeConteudo {
  if (!texto || !texto.trim()) {
    return { veredicto: 'desconhecido', categorias: [], achados: [] };
  }
  const normal = normalizarParaAnalise(texto);
  const achados: string[] = [];
  const categorias = new Set<CategoriaDeConteudo>();
  let fortes = 0;

  for (const item of LEXICO) {
    if (!contem(normal, item.termo)) continue;
    if (!passouNaGuarda(normal, item.termo)) continue;
    achados.push(item.termo);
    categorias.add(item.categoria);
    if (item.peso === 'forte') fortes += 1;
  }

  // Violência sozinha não condena, por mais leve que seja a conta: um hino que
  // fala de sangue e de guerra espiritual acumularia "leves" e seria reprovado
  // pela ferramenta criada para protegê-lo.
  const levesQueContam = achados.filter((t) => {
    const item = LEXICO.find((x) => x.termo === t);
    return item?.peso === 'leve' && item.categoria !== 'violencia';
  }).length;

  const explicito = fortes > 0 || levesQueContam >= 2;
  return {
    veredicto: explicito ? 'explicito' : 'limpo',
    categorias: [...categorias],
    achados,
  };
}

export interface FaixaParaAnalisar {
  titulo?: string | null;
  /** A letra inteira, em texto corrido. Ausente = não dá para julgar. */
  letra?: string | null;
}

/**
 * Classifica uma faixa a partir do que se sabe dela.
 *
 * O TÍTULO é evidência de condenação, nunca de inocência: título limpo não diz
 * nada sobre a letra, mas título com palavrão dispensa a letra. Por isso, sem
 * letra, um título limpo devolve `desconhecido` — e não `limpo`.
 */
export function classificarFaixa(faixa: FaixaParaAnalisar): AnaliseDeConteudo {
  const doTitulo = classificarTexto(faixa.titulo);
  if (doTitulo.veredicto === 'explicito') return doTitulo;

  const daLetra = classificarTexto(faixa.letra);
  if (daLetra.veredicto === 'desconhecido') {
    return { veredicto: 'desconhecido', categorias: [], achados: [] };
  }
  return daLetra;
}
