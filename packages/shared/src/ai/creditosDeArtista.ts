/**
 * UM CRÉDITO, VÁRIOS ARTISTAS — a regra única de separar "A, B", "A & B",
 * "A feat. B", "A x B" e "MC A e MC B" em pessoas distintas.
 *
 * Caso real que motivou isto (27/10/2026): a página de artista mostrava o
 * título "Tz da Coronel, Matuê", com UMA música, como se fosse um artista só.
 * A faixa veio do YouTube Music com `artists: ["Tz da Coronel", "Matuê"]`, o
 * importador juntou com ", " para mandar no cabeçalho, e o app, que separava
 * `&`, ` x ` e `feat.`, deixava a VÍRGULA de propósito para uma IA que nem
 * sempre roda. Resultado: nem "Tz da Coronel" nem "Matuê" tinham a música na
 * própria página, e um artista falso nasceu no acervo, no sitemap e nas urls.
 *
 * O que separa, e por quê:
 *   • participação (`feat.`, `ft.`, `part.`, `com`, `with`): sempre — ninguém
 *     se chama "feat";
 *   • `&`, `+`, `;`, ` x `, ` vs ` e a VÍRGULA: sempre, salvo os poucos grupos
 *     cujo nome legítimo carrega o separador ("Earth, Wind & Fire", "Tyler,
 *     The Creator"), listados em `GRUPOS_COM_SEPARADOR_NO_NOME`;
 *   • ` e `/` and `: SÓ quando há prova de que são duas pessoas. "Chitãozinho
 *     e Xororó" é UMA dupla; "MC Kevin e MC Ryan SP" são dois. A prova é cada
 *     lado começar com MC/DJ (crédito de funk) ou cada lado já existir sozinho
 *     como artista (`conhecido`, que o chamador monta com o acervo que tem).
 *   • a barra NÃO separa: "Cat Stevens/Yusuf Islam" é a mesma pessoa.
 *
 * Função pura, sem rede: vale igual no app, na API e no script de correção do
 * banco, para que os três cheguem ao MESMO resultado para o mesmo texto.
 */
import { ehSelo } from './gravadoraComoArtista.js';

/**
 * Nome → chave de comparação: minúsculas, sem acento, espaços colapsados e
 * TODO separador virando " e ". Assim "Earth, Wind & Fire", "Earth Wind and
 * Fire" e os pedaços "Earth" + "Wind" + "Fire" remontados dão a mesma chave —
 * é o que permite reconhecer um grupo depois de o texto já ter sido partido.
 */
function chave(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*(?:,|&|\+|;)\s*|\s+and\s+|\s+e\s+/g, ' e ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grupos e duplas cujo nome legítimo contém um separador. Comparados pela
 * chave (sem acento, sem caixa). A lista cresce com o que aparece de verdade.
 */
export const GRUPOS_COM_SEPARADOR_NO_NOME: ReadonlySet<string> = new Set(
  [
    // com vírgula, "&" ou "+"
    'AC/DC',
    'Earth, Wind & Fire',
    'Simon & Garfunkel',
    'Hall & Oates',
    'Above & Beyond',
    'Florence + The Machine',
    'Tyler, The Creator',
    'Crosby, Stills & Nash',
    'Crosby, Stills, Nash & Young',
    'Now, Now',
    'Sam & Dave',
    'Kool & The Gang',
    'Blood, Sweat & Tears',
    'Derek & The Dominos',
    'Mumford & Sons',
    'Macklemore & Ryan Lewis',
    'Sly & The Family Stone',
    'Nick Cave & The Bad Seeds',
    'Brooks & Dunn',
    'Emerson, Lake & Palmer',
    'Peter, Paul and Mary',
    'Huey Lewis & The News',
    'Tom Petty & The Heartbreakers',
    'Bob Marley & The Wailers',
    'Big Brother & The Holding Company',
    'Hootie & The Blowfish',
    'Echo & The Bunnymen',
    'Captain & Tennille',
    'Chase & Status',
    'Dimitri Vegas & Like Mike',
    'Dan + Shay',
    'Years & Years',
    'Tibagi e Miltinho',
    'Prince and the Revolution',
    'Ryu, the Runner',
    'Bruno & Marrone',
    // duplas brasileiras com "e" no nome
    'Chitãozinho e Xororó',
    'Zezé Di Camargo e Luciano',
    'Jorge e Mateus',
    'Henrique e Juliano',
    'Bruno e Marrone',
    'Victor e Leo',
    'João Bosco e Vinícius',
    'César Menotti e Fabiano',
    'Matheus e Kauan',
    'Maiara e Maraisa',
    'Simone e Simaria',
    'Edson e Hudson',
    'Rionegro e Solimões',
    'Gian e Giovani',
    'Leandro e Leonardo',
    'Zé Neto e Cristiano',
    'Israel e Rodolffo',
    'Hugo e Guilherme',
    'Guilherme e Benuto',
    'Fernando e Sorocaba',
    'João Neto e Frederico',
    'Tonico e Tinoco',
    'Milionário e José Rico',
    'Chrystian e Ralf',
    'Gino e Geno',
    'Teodoro e Sampaio',
    'Marcos e Belutti',
    'Munhoz e Mariano',
    'Sandy e Junior',
    'Liu e Léu',
    'Zé Mulato e Cassiano',
    'Cacique e Pajé',
    'Pena Branca e Xavantinho',
    'Tião Carreiro e Pardinho',
    'Tião Carreiro e Paraíso',
    'Zé Fortuna e Pitangueira',
    'MC Loma e As Gêmeas Lacração',
    'Murillo e LT no Beat',
    'DJ Murillo e LT no Beat',
    'Zé Carreiro e Carreirinho',
    'Cézar e Paulinho',
    'Goiano e Paranaense',
    'Divino e Donizete',
    'Léo Canhoto e Robertinho',
    'Jads e Jadson',
    'Pedro Paulo e Alex',
    'Day e Lara',
    'Diego e Victor Hugo',
    'Clayton e Romário',
    'Thaeme e Thiago',
    'George Henrique e Rodrigo',
    'Breno e Caio César',
    'Zé Felipe e Miguel',
    'Carreiro e Capataz',
    'Pedro Bento e Zé da Estrada',
    'Jacó e Jacozinho',
    'Lourenço e Lourival',
    'Craveiro e Cravinho',
    'Mato Grosso e Mathias',
    'Rick e Renner',
    'Guilherme e Santiago',
    'João Carreiro e Capataz',
    'Zé Henrique e Gabriel',
    'Felipe e Falcão',
    'Marcos e Fernando',
    'Jefferson e Suellen',
    'Bombom e Chocolate',
    'Ferreirinha e Joari',
    'Anderson e Rondinelly',
    'Antony e Gabriel',
    'Carlos e Jader',
    'Lucas e Orelha',
    'Cleber e Cauan',
    'Conrado e Aleksandro',
    'João Pedro e Cristiano',
    'Alan e Alex',
    'Tom e Arnaldo',
    'Michel e Luís',
    'Rafael e Gabriel',
    'Mariana e Mateus',
    'Léo e Raphael',
    'Léo e Júnior',
    'Rogério e Rodrigo',
    'Ataíde e Alexandre',
    'Pedro e Thiago',
  ].map(chave),
);

/** O crédito inteiro (ou um pedaço dele) é um nome legítimo com separador? */
function ehGrupo(nome: string): boolean {
  return GRUPOS_COM_SEPARADOR_NO_NOME.has(chave(nome));
}

/**
 * Marcas de participação: SEMPRE separam. O `\b` fecha borda antes do ponto, e
 * o `\.?` come o ponto para não sobrar "." grudado no próximo nome.
 */
const PARTICIPACAO =
  /\s*[([]?\s*\b(?:feat(?:\.|uring)?|ft\.?|part(?:\.|icipa[cç][aã]o(?:\s+especial)?)?|com|with)\b\.?\s*/gi;

/**
 * Separadores seguros: vírgula, "&", "+", ";", " x ", " vs ". "x" e "vs" exigem
 * espaço dos DOIS lados — "MC PP da VS" termina em "VS" e não pode ser cortado.
 */
const SEPARADOR_SEGURO = /\s*(?:,|&|\+|;)\s*|\s+(?:x|vs\.?)\s+/gi;

/** "A e B", "A and B" — só separa com prova (ver `deveSepararConjuncao`). */
const CONJUNCAO = /\s+(?:e|and)\s+/gi;

/** Crédito de funk: cada lado começa com MC/DJ, então são pessoas distintas. */
const PREFIXO_DE_FUNK = /^(?:mc|dj|mcs)\b/i;

export interface OpcoesDeSeparacao {
  /**
   * Este nome já existe SOZINHO como artista no acervo que o chamador conhece?
   * É a prova que libera o " e ": "Kawe e Wiu" só vira dois se "Kawe" e "Wiu"
   * forem artistas por conta própria. Sem a função, só o prefixo MC/DJ prova.
   */
  conhecido?: (nome: string) => boolean;
}

function deveSepararConjuncao(lados: readonly string[], opcoes: OpcoesDeSeparacao): boolean {
  if (lados.length < 2) return false;
  if (lados.every((l) => PREFIXO_DE_FUNK.test(l))) return true;
  const conhecido = opcoes.conhecido;
  if (!conhecido) return false;
  return lados.every((l) => conhecido(l));
}

/**
 * Tira o que sobra de separador nas pontas de um pedaço: espaço, vírgula,
 * ponto-e-vírgula, travessão e um fecha-parêntese/colchete órfão no começo.
 * O ponto final FICA ("Charlie Brown Jr.", "R.E.M.") e o parêntese de fecho
 * também ("Black Orpheus (Manha de Carnaval)") — são parte do nome.
 */
function aparar(pedaco: string): string {
  let p = pedaco
    .replace(/^[\s)\].,;:\-–—]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .trim();
  // Parêntese ÓRFÃO sai: "Hungria (part. Lucas Lucco)" partido no "part." deixa
  // "Lucas Lucco)" de um lado e "Hungria (" do outro. Um par fechado fica.
  const abre = (p.match(/[([]/g) ?? []).length;
  const fecha = (p.match(/[)\]]/g) ?? []).length;
  if (fecha > abre) p = p.replace(/[)\]]+$/, '').trim();
  if (abre > fecha)
    p = p
      .replace(/^[([]+/, '')
      .replace(/[([]+$/, '')
      .trim();
  return p;
}

/** Parte o texto e GUARDA os separadores, para remontar um grupo com o texto original. */
function partir(texto: string, sep: RegExp): { partes: string[]; seps: string[] } {
  const partes: string[] = [];
  const seps: string[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(sep)) {
    if (m.index === undefined || m[0].length === 0) continue;
    partes.push(texto.slice(ultimo, m.index));
    seps.push(m[0]);
    ultimo = m.index + m[0].length;
  }
  partes.push(texto.slice(ultimo));
  return { partes, seps };
}

/**
 * Parte o texto por `sep` e remonta os pedaços vizinhos que juntos formam um
 * grupo conhecido — com o texto ORIGINAL entre eles: "Jerry Smith e MC Loma e
 * As Gêmeas Lacração" vira ["Jerry Smith", "MC Loma e As Gêmeas Lacração"],
 * e "Dan + Shay, Justin Bieber" devolve "Dan + Shay", não "Dan, Shay".
 */
function remontarGrupos(texto: string, sep: RegExp): string[] {
  const { partes, seps } = partir(texto, sep);
  const saida: string[] = [];
  for (let i = 0; i < partes.length;) {
    let juntou = false;
    for (const tamanho of [3, 2]) {
      if (i + tamanho > partes.length) continue;
      let bloco = partes[i]!;
      for (let k = 1; k < tamanho; k++) bloco += seps[i + k - 1]! + partes[i + k]!;
      const limpo = aparar(bloco);
      if (limpo && ehGrupo(limpo)) {
        saida.push(limpo);
        i += tamanho;
        juntou = true;
        break;
      }
    }
    if (!juntou) {
      const limpo = aparar(partes[i]!);
      if (limpo) saida.push(limpo);
      i += 1;
    }
  }
  return saida;
}

function semRepetidos(nomes: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const n of nomes) {
    const nome = aparar(n);
    if (!nome) continue;
    const k = chave(nome);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(nome);
  }
  return saida;
}

/** Troca cada "(…)" por um marcador que nenhum separador alcança, e devolve a volta. */
function protegerParenteses(texto: string): { texto: string; restaurar: (s: string) => string } {
  const guardados: string[] = [];
  const marcado = texto.replace(/\([^()]*\)/g, (trecho) => {
    guardados.push(trecho);
    return `⁣${guardados.length - 1}⁣`;
  });
  const restaurar = (s: string): string =>
    s.replace(/⁣(\d+)⁣/g, (_, i: string) => guardados[Number(i)] ?? '');
  return { texto: marcado, restaurar };
}

/**
 * Separa um crédito em nomes distintos. Sempre devolve ao menos um nome quando
 * a entrada não é vazia — na dúvida, o texto original inteiro.
 */
export function separarCreditos(bruto: string, opcoes: OpcoesDeSeparacao = {}): string[] {
  const texto = (bruto ?? '').trim();
  if (!texto) return [];
  if (ehGrupo(texto)) return [texto];

  // O que está ENTRE PARÊNTESES não é lista de artistas: "Olly Alexander
  // (Years & Years)" é uma pessoa, "Mc Gw (Dj Kennedy e Dj Guina)" é um crédito
  // com os DJs anotados. Só a participação sai do parêntese antes —
  // "(part. Lucas Lucco)" é separador de verdade.
  const { texto: protegido, restaurar } = protegerParenteses(
    texto.replace(
      /\(\s*((?:feat(?:uring)?|ft|part|participa[cç][aã]o|com|with)\.?\s+[^)]*)\)/gi,
      ' $1',
    ),
  );

  const saida: string[] = [];
  for (const porParticipacao of protegido.split(PARTICIPACAO)) {
    const p1 = aparar(porParticipacao);
    if (!p1) continue;
    if (ehGrupo(p1)) {
      saida.push(p1);
      continue;
    }
    const pedacos = remontarGrupos(p1, SEPARADOR_SEGURO);
    for (const p2 of pedacos) {
      if (ehGrupo(p2)) {
        saida.push(p2);
        continue;
      }
      const lados = remontarGrupos(p2, CONJUNCAO);
      if (lados.length > 1 && deveSepararConjuncao(lados, opcoes)) saida.push(...lados);
      else saida.push(p2);
    }
  }

  let nomes = semRepetidos(saida.map(restaurar));
  // Selo na lista de créditos ("Atlantic Records, Cardi B") não canta: sai,
  // desde que sobre alguém. Sozinho, fica — melhor um nome que nenhum.
  const semSelo = nomes.filter((n) => !ehSelo(n));
  if (semSelo.length > 0 && semSelo.length < nomes.length) nomes = semSelo;
  return nomes.length > 0 ? nomes : [texto];
}

/**
 * O crédito ainda merece um segundo olhar (de uma IA, por exemplo)? Só a barra
 * sobrou como separador ambíguo: pode ser apelido ("Cat Stevens/Yusuf") ou dois
 * nomes ("Alok/Sevenn").
 */
export function creditoAmbiguo(bruto: string): boolean {
  const t = (bruto ?? '').trim();
  if (!t || ehGrupo(t)) return false;
  return t.includes('/');
}

export interface ArtistaComNome {
  name: string;
}

/**
 * A lista de artistas de uma faixa, com cada crédito junto desfeito.
 *
 * Devolve o MESMO array quando nada muda — quem chama compara por identidade
 * para não copiar cinco mil faixas à toa. Quando um crédito vira vários, o
 * primeiro nome herda o objeto original (id, slug) e os demais nascem só com o
 * nome e o que havia de genérico; um id de "artista composto" não pode ser
 * herdado por duas pessoas.
 */
export function separarArtistasDaFaixa<T extends ArtistaComNome>(
  artistas: readonly T[],
  opcoes: OpcoesDeSeparacao = {},
): T[] {
  let mudou = false;
  const saida: T[] = [];
  for (const a of artistas) {
    const nome = typeof a?.name === 'string' ? a.name : '';
    const nomes = nome ? separarCreditos(nome, opcoes) : [];
    if (nomes.length <= 1 && (nomes[0] ?? nome) === nome) {
      saida.push(a);
      continue;
    }
    mudou = true;
    nomes.forEach((n, i) => {
      if (i === 0) {
        saida.push({ ...a, name: n });
        return;
      }
      const novo = { ...(a as unknown as Record<string, unknown>), name: n };
      if ('id' in novo && typeof novo.id === 'string') novo.id = `${novo.id}:${i}`;
      if ('slug' in novo) novo.slug = '';
      if ('order' in novo && typeof novo.order === 'number') novo.order = novo.order + i;
      saida.push(novo as T);
    });
  }
  if (!mudou) return artistas as T[];
  // O mesmo artista creditado duas vezes ("Justin Bieber, Skrillex, Justin
  // Bieber") fica uma só.
  const vistos = new Set<string>();
  return saida.filter((a) => {
    const k = chave(a.name);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
