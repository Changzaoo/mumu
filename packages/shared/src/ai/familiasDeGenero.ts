/**
 * O QUE PODE TOCAR DEPOIS DO QUÊ.
 *
 * O rádio de uma faixa montava a fila assim: mesmo artista, depois mesmo
 * gênero, depois A BIBLIOTECA INTEIRA. Esse terceiro nível não olhava gênero
 * nenhum — e ele é o que enche a fila na prática, porque os dois primeiros
 * acabam rápido.
 *
 * O resultado é o pior erro que este app pode cometer: alguém põe um louvor
 * para tocar, sai da tela, e a fila continua sozinha até entregar funk com
 * palavrão. A pessoa não pediu nada daquilo. Ela não reclama — ela vai embora,
 * e conta para os outros por que foi.
 *
 * ── FAMÍLIA, E NÃO GÊNERO EXATO ──
 *
 * Exigir gênero idêntico deixaria o rádio de Samba sem Pagode e o de Trap sem
 * Rap — vizinhos que ninguém estranha juntos. A unidade certa é a FAMÍLIA:
 * dentro dela a mistura é natural, fora dela é invasão.
 *
 * ── A ASSIMETRIA QUE IMPORTA ──
 *
 * As famílias não são todas iguais em risco. Receber um samba num rádio de rock
 * é um erro de gosto; receber funk explícito num rádio de louvor é um erro de
 * respeito. Por isso `devocional` é SENSÍVEL, e sensível significa três
 * exigências a mais, não uma:
 *
 *   1. mesma família — como em todas;
 *   2. gênero CONHECIDO: faixa sem gênero fica de fora. Em toda outra parte do
 *      app a dúvida é resolvida a favor de mostrar; aqui, contra;
 *   3. conteúdo não explícito E não desconhecido (ver `conteudoExplicito`).
 *
 * A soma das três encolhe o rádio de gospel. É de propósito: um rádio curto é
 * um problema de produto, um rádio ofensivo é a perda da pessoa.
 */
import type { Genre } from './curation.js';
import type { VeredictoDeConteudo } from './conteudoExplicito.js';

export type FamiliaDeGenero =
  | 'devocional'
  | 'urbano'
  | 'sertanejo'
  | 'samba'
  | 'mpb'
  | 'rock'
  | 'eletronica'
  | 'soul'
  | 'latino'
  | 'pop'
  | 'classica'
  | 'ambiente';

/**
 * De qual família é cada gênero da taxonomia.
 *
 * Cobre `GENRE_TAXONOMY` inteira de propósito: gênero que caísse fora viraria
 * `null` e seria tratado como desconhecido, o que na prática o excluiria dos
 * rádios sensíveis sem que ninguém entendesse por quê.
 */
const FAMILIA: Readonly<Record<Genre, FamiliaDeGenero>> = {
  Gospel: 'devocional',

  Funk: 'urbano',
  Trap: 'urbano',
  'Hip-Hop/Rap': 'urbano',

  Sertanejo: 'sertanejo',
  Forró: 'sertanejo',
  Country: 'sertanejo',

  Pagode: 'samba',
  Samba: 'samba',
  Axé: 'samba',

  MPB: 'mpb',

  Rock: 'rock',
  Metal: 'rock',
  Indie: 'rock',

  Eletrônica: 'eletronica',
  Dance: 'eletronica',

  'R&B/Soul': 'soul',
  Jazz: 'soul',
  Blues: 'soul',

  Reggae: 'latino',
  Reggaeton: 'latino',
  Latina: 'latino',

  Pop: 'pop',
  Clássica: 'classica',
  'Lo-Fi': 'ambiente',
};

/**
 * As famílias em que um erro custa a pessoa, e não só o próximo play.
 *
 * Hoje é uma só. A lista existe como lista porque a próxima — infantil — tem
 * exatamente a mesma natureza, e descobrir isso depois com a regra espalhada
 * pelo código seria pior.
 */
const SENSIVEIS: ReadonlySet<FamiliaDeGenero> = new Set<FamiliaDeGenero>(['devocional']);

/** Compara rótulos ignorando acento, caixa e pontuação. */
function chave(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const POR_CHAVE = new Map<string, FamiliaDeGenero>(
  Object.entries(FAMILIA).map(([genero, familia]) => [chave(genero), familia]),
);

/** A família deste gênero, ou `null` quando não sabemos qual é. */
export function familiaDoGenero(genero: string | null | undefined): FamiliaDeGenero | null {
  if (!genero) return null;
  return POR_CHAVE.get(chave(genero)) ?? null;
}

export function ehFamiliaSensivel(familia: FamiliaDeGenero | null): boolean {
  return familia !== null && SENSIVEIS.has(familia);
}

export interface FaixaParaConvivencia {
  genero?: string | null;
  /** Veredito do classificador de conteúdo. Ausente = desconhecido. */
  conteudo?: VeredictoDeConteudo | null;
}

/**
 * ESTA FAIXA PODE ENTRAR NUM RÁDIO SEMEADO POR AQUELA?
 *
 * Função pura, e é a única porta: todo lugar que monta continuação automática
 * passa por aqui. Espalhar a regra é como ela deixa de valer em algum canto.
 */
export function podemConviver(
  semente: FaixaParaConvivencia,
  candidata: FaixaParaConvivencia,
): boolean {
  const familiaSemente = familiaDoGenero(semente.genero);
  const familiaCandidata = familiaDoGenero(candidata.genero);

  // Semente sem gênero conhecido: não há fronteira a defender, e barrar tudo
  // deixaria o rádio vazio para uma faixa recém-importada. Só o conteúdo
  // explícito continua valendo como barreira em outro lugar.
  if (familiaSemente === null) return true;

  if (ehFamiliaSensivel(familiaSemente)) {
    // A dúvida resolve CONTRA entrar. Ver a assimetria no cabeçalho.
    if (familiaCandidata !== familiaSemente) return false;
    if (candidata.conteudo !== 'limpo') return false;
    return true;
  }

  // Fora das sensíveis: mesma família, e gênero desconhecido é aceito — barrá-lo
  // esvaziaria o rádio de quase toda faixa importada pelo próprio usuário, que
  // frequentemente chega sem categoria.
  return familiaCandidata === null || familiaCandidata === familiaSemente;
}
