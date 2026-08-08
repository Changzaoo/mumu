/**
 * Detector de duplicatas: a MESMA música entrando na biblioteca com títulos
 * diferentes.
 *
 * O caso real: a pessoa importa "Evidências" hoje e amanhã importa
 * "EVIDENCIAS - Chitãozinho e Xororó (Ao Vivo) [Official Video]" de outro
 * canal. São dois arquivos, dois cartões, duas entradas na busca — e a mesma
 * música. O de-dupe por URL de origem não pega isso (as URLs são diferentes) e
 * o de-dupe por hash do áudio também não (os arquivos são diferentes).
 *
 * TRÊS SINAIS, e os três precisam concordar antes de fundir:
 *   1. artista — o mesmo, depois de normalizar
 *   2. duração — dentro de uma tolerância (mesma gravação, encode diferente)
 *   3. título — o mesmo depois de tirar o ruído de YouTube, OU o DNA (vetor
 *      semântico) muito próximo
 *
 * FUNDIR É DESTRUTIVO e o usuário não vê acontecer. Por isso o corte é alto e
 * a assimetria é deliberada: deixar duas cópias é um incômodo, apagar a música
 * errada é perda. Na dúvida, não funde.
 */
import { cosineSimilarity } from './agents.js';

/** O mínimo que o detector precisa saber de uma faixa. */
export interface FaixaComparavel {
  id: string;
  title: string;
  artists: string[];
  durationMs?: number | null;
  /** Vetor semântico gravado pelo agente de DNA, quando existir. */
  dna?: readonly number[] | null;
  /** Para escolher quem fica: entrada com capa e álbum é a mais completa. */
  coverUrl?: string | null;
  album?: string | null;
  addedAt?: string | null;
}

export interface GrupoDuplicado {
  /** A entrada que FICA — a de metadata mais completa. */
  manter: FaixaComparavel;
  /** As que somem. */
  remover: FaixaComparavel[];
  /** Por que o detector concluiu que são a mesma música. */
  motivo: string;
}

/** Tolerância de duração: mesmo master, encoders diferentes. */
const TOLERANCIA_MS = 3_000;
/** Acima disto, dois títulos limpos são "o mesmo título". */
const MIN_TITULO = 0.86;
/**
 * A barra quando o artista NÃO confirma — mais alta de propósito.
 *
 * Sem o artista para corroborar, o título vira quase toda a evidência, e 0.86
 * ainda aceita variação demais ("Evidências" x "Evidências Ao Vivo" limpam
 * parecido). A 0.97 só passa o que é praticamente a mesma frase, e ainda assim
 * a duração precisa bater.
 */
const MIN_TITULO_SEM_ARTISTA = 0.97;
/** Acima disto, dois vetores descrevem a mesma música. */
const MIN_DNA = 0.94;

/**
 * Tira do título tudo que vem do YouTube e não é o nome da música.
 *
 * A lista cresce com o que aparece de verdade nos títulos importados; cada
 * padrão aqui já causou uma duplicata que passou batido.
 */
export function limparTitulo(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      // (Official Video), [Clipe Oficial], (Ao Vivo), (Lyric Video)…
      .replace(
        /[([][^)\]]*\b(official|oficial|video|videoclipe|clipe|lyric|letra|audio|hd|4k|remaster\w*|ao vivo|live|legendado|tradu\w*)\b[^)\]]*[)\]]/g,
        ' ',
      )
      // Sufixos soltos sem parênteses.
      .replace(
        /\b(official\s+(music\s+)?video|clipe\s+oficial|video\s+oficial|lyric\s+video)\b/g,
        ' ',
      )
      // "| Canal", "- Topic", "#shorts"
      .replace(/\|[^|]*$/g, ' ')
      .replace(/\s-\s*topic\b/g, ' ')
      .replace(/#\w+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** Nome de artista comparável. */
export function limparArtista(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Semelhança entre dois títulos limpos (0..1), por palavras em comum.
 *
 * Palavra, e não caractere: "evidencias ao vivo" e "evidencias" têm quase todos
 * os caracteres em comum de qualquer jeito, mas a comparação que importa é
 * quantas PALAVRAS da menor aparecem na maior.
 */
export function semelhancaDeTitulo(a: string, b: string): number {
  const pa = new Set(a.split(' ').filter(Boolean));
  const pb = new Set(b.split(' ').filter(Boolean));
  if (pa.size === 0 || pb.size === 0) return 0;
  const menor = pa.size <= pb.size ? pa : pb;
  const maior = menor === pa ? pb : pa;
  let comuns = 0;
  for (const p of menor) if (maior.has(p)) comuns += 1;
  return comuns / menor.size;
}

/**
 * Semelhança que olha os DOIS conjuntos (Jaccard), não só a contenção.
 *
 * Usada quando não há artista para corroborar. Palavra que existe só de um lado
 * pesa contra — é ela que separa "Evidências" de "Evidências Part. Zé Neto",
 * que a medida por contenção dava como idênticas.
 */
export function semelhancaSimetrica(a: string, b: string): number {
  const pa = new Set(a.split(' ').filter(Boolean));
  const pb = new Set(b.split(' ').filter(Boolean));
  if (pa.size === 0 || pb.size === 0) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns += 1;
  return comuns / (pa.size + pb.size - comuns);
}

/** Os dois artistas principais são a mesma pessoa/grupo? */
function mesmoArtista(a: FaixaComparavel, b: FaixaComparavel): boolean {
  const na = a.artists.map(limparArtista).filter(Boolean);
  const nb = b.artists.map(limparArtista).filter(Boolean);
  if (na.length === 0 || nb.length === 0) return false;
  // Basta o principal bater: "Matuê" e "Matuê, Teto" são a mesma faixa com
  // crédito de feat a mais num dos lados — que é justamente o caso comum.
  return na[0] === nb[0] || na.some((x) => nb.includes(x));
}

function duracaoCompativel(a: FaixaComparavel, b: FaixaComparavel): boolean {
  // Sem duração de um dos lados não dá para confirmar: o sinal fica de fora e
  // os outros dois têm que carregar sozinhos — por isso exigimos DNA alto lá
  // embaixo quando é este o caso.
  if (!a.durationMs || !b.durationMs) return false;
  return Math.abs(a.durationMs - b.durationMs) <= TOLERANCIA_MS;
}

/**
 * As duas entradas são a mesma música? Devolve o motivo, ou `null`.
 */
export function saoAMesma(a: FaixaComparavel, b: FaixaComparavel): string | null {
  if (a.id === b.id) return null;

  const tituloA = limparTitulo(a.title);
  const tituloB = limparTitulo(b.title);
  const semTitulo = semelhancaDeTitulo(tituloA, tituloB);
  const dna =
    a.dna && b.dna && a.dna.length === b.dna.length ? cosineSimilarity(a.dna, b.dna) : null;

  const duracaoBate = duracaoCompativel(a, b);

  // O ARTISTA DEIXOU DE SER PORTÃO — mas só quando ele está AUSENTE, nunca
  // quando ele contradiz. A diferença entre as duas coisas é tudo.
  //
  // Era a primeira linha da função: `if (!mesmoArtista(a, b)) return null`. Só
  // que "não bate" juntava dois casos opostos: (a) um dos lados não tem artista
  // utilizável, e (b) os dois têm e são pessoas diferentes. Tratar os dois como
  // "não funde" deixava passar duplicata de verdade — faixa importada por link
  // nasce sem artista confiável, e duas cópias da mesma música nunca chegavam a
  // ser comparadas. É por isso que nem título idêntico era detectado.
  //
  // Separando os casos: sem artista para consultar, o título e a duração
  // carregam sozinhos e a barra sobe. Com artistas que se contradizem, não
  // funde nunca — é aí que mora o cover, e "Evidências" do Chitãozinho não pode
  // engolir "Evidências" da Lauana Prado.
  const temArtista = (f: FaixaComparavel): boolean =>
    f.artists.some((n) => limparArtista(n).length > 0);
  const artistaBate = mesmoArtista(a, b);
  const artistaContradiz = temArtista(a) && temArtista(b) && !artistaBate;

  if (semTitulo >= MIN_TITULO && duracaoBate && artistaBate) {
    return `mesmo título limpo (${semTitulo.toFixed(2)}) e duração compatível`;
  }
  if (!artistaContradiz && duracaoBate) {
    // SIMÉTRICA, não por contenção — e a diferença aqui decide de verdade.
    //
    // `semelhancaDeTitulo` mede quantas palavras da MENOR aparecem na maior. Com
    // o artista confirmando, isso é o que se quer: "Evidências" e "EVIDENCIAS -
    // Chitãozinho e Xororó" são a mesma faixa e a contenção é o sinal.
    //
    // Sem artista, a mesma conta vira armadilha: "Evidências" cabe inteirinha
    // dentro de "Evidências Part. Zé Neto" e dá 1.00 — duas gravações
    // diferentes fundidas com nota máxima. Comparando os dois conjuntos nos
    // DOIS sentidos, sobra o que realmente é a mesma frase.
    const jaccard = semelhancaSimetrica(tituloA, tituloB);
    if (jaccard >= MIN_TITULO_SEM_ARTISTA) {
      return `título quase idêntico (${jaccard.toFixed(2)}) e duração compatível, sem artista para conferir`;
    }
  }
  if (artistaContradiz) return null; // cover/regravação — ver acima

  // Caminho 2: sem duração para conferir, o DNA precisa ser quase idêntico E o
  // título ainda ter de bater. Um sinal só nunca funde.
  if (dna !== null && dna >= MIN_DNA && semTitulo >= MIN_TITULO) {
    return `DNA ${dna.toFixed(3)} e título ${semTitulo.toFixed(2)}`;
  }

  return null;
}

/**
 * Qual entrada fica. Vence a mais completa; empate vai para a mais antiga, que
 * é a que já está em playlists e no histórico do usuário.
 */
export function melhorEntrada(a: FaixaComparavel, b: FaixaComparavel): FaixaComparavel {
  const pontos = (f: FaixaComparavel): number =>
    (f.coverUrl ? 2 : 0) + (f.album ? 1 : 0) + (f.durationMs ? 1 : 0);
  const pa = pontos(a);
  const pb = pontos(b);
  if (pa !== pb) return pa > pb ? a : b;
  const ta = a.addedAt ? Date.parse(a.addedAt) : Number.MAX_SAFE_INTEGER;
  const tb = b.addedAt ? Date.parse(b.addedAt) : Number.MAX_SAFE_INTEGER;
  return ta <= tb ? a : b;
}

/**
 * Agrupa as duplicatas de uma biblioteca.
 *
 * O agrupamento é transitivo de propósito: se A é igual a B e B é igual a C,
 * os três viram um grupo só, mesmo que A e C não tenham casado direto. Sem
 * isso a mesma música sobreviveria em duas cópias depois da fusão.
 */
export function agruparDuplicatas(faixas: readonly FaixaComparavel[]): GrupoDuplicado[] {
  const grupoDe = new Map<string, number>();
  const grupos: FaixaComparavel[][] = [];
  const motivos: string[] = [];

  for (let i = 0; i < faixas.length; i += 1) {
    const a = faixas[i]!;
    for (let j = i + 1; j < faixas.length; j += 1) {
      const b = faixas[j]!;
      const motivo = saoAMesma(a, b);
      if (!motivo) continue;

      const ga = grupoDe.get(a.id);
      const gb = grupoDe.get(b.id);

      if (ga === undefined && gb === undefined) {
        grupoDe.set(a.id, grupos.length);
        grupoDe.set(b.id, grupos.length);
        grupos.push([a, b]);
        motivos.push(motivo);
      } else if (ga !== undefined && gb === undefined) {
        grupoDe.set(b.id, ga);
        grupos[ga]!.push(b);
      } else if (gb !== undefined && ga === undefined) {
        grupoDe.set(a.id, gb);
        grupos[gb]!.push(a);
      } else if (ga !== gb) {
        // Dois grupos que se tocam viram um só.
        const [fica, some] = ga! < gb! ? [ga!, gb!] : [gb!, ga!];
        for (const f of grupos[some]!) {
          grupoDe.set(f.id, fica);
          grupos[fica]!.push(f);
        }
        grupos[some] = [];
      }
    }
  }

  const out: GrupoDuplicado[] = [];
  grupos.forEach((membros, i) => {
    if (membros.length < 2) return;
    const unicos = [...new Map(membros.map((m) => [m.id, m])).values()];
    if (unicos.length < 2) return;
    const manter = unicos.reduce(melhorEntrada);
    out.push({
      manter,
      remover: unicos.filter((f) => f.id !== manter.id),
      motivo: motivos[i] ?? 'duplicata',
    });
  });
  return out;
}
