/**
 * GRAVADORA NÃO É ARTISTA — e confundir as duas estraga tudo em cascata.
 *
 * O nome do artista de uma faixa importada por link vem do canal que publicou o
 * vídeo. Quando quem publica é a GRAVADORA, o artista gravado vira o nome dela:
 *
 *   "MK MUSIC, Anderson Freire"   →  artista principal: MK MUSIC
 *   "MK MUSIC, Midian Lima"       →  artista principal: MK MUSIC
 *   "MK MUSIC, Elaine Martins"    →  artista principal: MK MUSIC
 *
 * Três estragos saem daí, e nenhum é óbvio olhando uma faixa sozinha:
 *
 *  1. A FOTO. A ficha do artista busca a imagem pelo nome — e traz o logotipo da
 *     gravadora no lugar do rosto do cantor, em todas as faixas dela.
 *
 *  2. O GÊNERO. A coerência por artista (`generoDoArtista`) funciona porque a
 *     discografia de uma pessoa costuma ter um gênero dominante; a faixa que
 *     destoa é corrigida pela maioria. Com a gravadora no lugar do artista, onze
 *     faixas de cantores diferentes votam juntas, nenhuma maioria se forma, e o
 *     gênero errado que veio da fonte sobrevive intacto. Foi assim que
 *     "Raridade", do Anderson Freire, ficou em SERTANEJO — e a prateleira Gospel
 *     apareceu vazia de músicas que estavam lá dentro o tempo todo.
 *
 *  3. A PRATELEIRA. "MK MUSIC" vira um artista com dezenas de faixas na
 *     biblioteca, ocupando o lugar dos cantores de verdade.
 *
 * O conserto é devolver o crédito: quando o primeiro nome é de uma gravadora e
 * existe outro artista na lista, o outro assume. A gravadora não é apagada — ela
 * continua na lista, só deixa de ser a principal, porque a informação é
 * verdadeira e útil (é a gravadora mesmo), só não é o artista.
 */

/**
 * Selos e canais que publicam música de terceiros.
 *
 * Lista fechada e conservadora: um nome só entra quando é inequivocamente uma
 * gravadora. O risco de errar para o outro lado é real — existe artista cujo
 * nome parece selo — e remover o crédito de quem cantou é pior do que deixar um
 * selo a mais na lista.
 */
const GRAVADORAS = [
  // Gospel — o caso que motivou isto.
  'mk music',
  'mk publicidade',
  'central gospel',
  'graca music',
  'onimusic',
  'todah music',
  'som e louvor',
  // Majors e nacionais.
  'som livre',
  'universal music',
  'sony music',
  'warner music',
  'emi music',
  'deckdisc',
  'biscoito fino',
  'discos garagem',
  // Selos de rap/trap brasileiros que publicam pelo próprio canal.
  '30praum',
  'pineapple storm',
  'pineapple storm tv',
  'laboratorio fantasma',
  'boombap records',
];

/** Normaliza para comparar: sem acento, sem caixa, sem pontuação. */
function chave(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `true` quando o nome é de uma gravadora, não de quem canta. */
export function ehGravadora(nome: string): boolean {
  const k = chave(nome);
  if (!k) return false;
  // Igualdade, não "contém": "Sony Music" é selo, mas um artista chamado
  // "Music" ou "Storm" não pode ser confundido com um.
  if (GRAVADORAS.includes(k)) return true;
  // Sufixos que só aparecem em canal de selo ("MK MUSIC Oficial", "… TV").
  //
  // O sufixo vem COLADO com frequência — o canal do selo do Matuê se chama
  // "Pineapple StormTV", sem espaço. Com `\s+` obrigatório ele não era
  // reconhecido, e o nome do selo ia para o campo de quem canta. Aceitar a
  // versão colada é seguro porque o que sobra ainda precisa estar na lista
  // fechada acima: "Kurtv" vira "kur", que não é gravadora nenhuma.
  const semSufixo = k.replace(/\s*(oficial|official|tv|records?|music)$/, '').trim();
  return semSufixo !== k && GRAVADORAS.includes(semSufixo);
}

/**
 * SELO POR TOKEN — o reconhecimento amplo, para filtrar quem NÃO canta de uma
 * lista de artistas.
 *
 * `ehGravadora` é uma lista fechada, de propósito: ela decide o crédito PRINCIPAL
 * de uma faixa e errar ali apaga o cantor. Mas dentro de uma lista já separada
 * ("Ton Carfi, Rocket Music Brazil", "Make The Girls Dance Records, HUGEL") o
 * selo se anuncia por um token que nome de gente não carrega — e ali dá para ser
 * mais ousado, porque o outro nome da lista continua sendo o artista.
 *
 * A regra: carregar a palavra "Records"/"Recordings", ou TERMINAR em
 * "Music"/"Music Brasil"/"Music Brazil"/"Entertainment". Sempre com uma palavra
 * ANTES do token — "Music" sozinho não é selo (é ambíguo demais), e um nome
 * curto sem nenhum desses tokens NUNCA entra aqui.
 */
export function ehSelo(nome: string): boolean {
  if (ehGravadora(nome)) return true;
  const k = chave(nome);
  if (!k) return false;
  if (/\brecord(?:s|ings)\b/.test(k)) return true;
  if (/\S+\s+(?:music(?:\s+bra[sz]il)?|entertainment)$/.test(k)) return true;
  return false;
}

/** Tira acento sem mexer no comprimento — para o índice continuar valendo. */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Um selo por nome, com as palavras separadas por qualquer pontuação —
 * "MK Music", "MK-MUSIC", "( MK Music)".
 */
const PADROES = GRAVADORAS.map(
  (g) => new RegExp(`(?<![a-z0-9])${g.split(' ').join('[^a-z0-9]+')}(?![a-z0-9])`, 'i'),
);

/**
 * ACHA O SELO DENTRO DO NOME DO VÍDEO.
 *
 * O canal nem sempre é a gravadora: o selo aparece grudado no próprio título,
 * entre parênteses — "Não Pare ( MK Music)", "Deus Proverá [Som Livre]",
 * "Jó - COM LETRA (VideoLETRA® oficial MK Music)". Sem alguém para reconhecer
 * isso, "( MK Music)" ficava dentro do nome da música: a faixa aparecia com o
 * selo colado no cartão e nunca casava com a mesma música importada de outro
 * canal.
 *
 * Devolve o trecho como ele aparece no texto, para o selo ser gravado do jeito
 * que o dono do canal escreve.
 */
export function acharGravadora(texto: string): string | null {
  if (!texto) return null;
  const plano = semAcento(texto);
  const fonte = plano.length === texto.length ? texto : plano;
  for (const padrao of PADROES) {
    const m = padrao.exec(plano);
    if (m) return fonte.slice(m.index, m.index + m[0].length);
  }
  return null;
}

export interface ArtistaMinimo {
  name: string;
}

/**
 * Reordena a lista de artistas para que quem canta venha primeiro.
 *
 * Devolve `null` quando não há nada a fazer — assim quem chama consegue
 * distinguir "já estava certo" de "corrigi", e não grava por grava.
 */
export function promoverArtistaReal<T extends ArtistaMinimo>(artistas: readonly T[]): T[] | null {
  if (artistas.length < 2) return null; // sem alternativa, o crédito fica
  if (!ehGravadora(artistas[0]!.name)) return null; // já está certo

  const real = artistas.findIndex((a) => !ehGravadora(a.name));
  if (real <= 0) return null; // são todos selos: melhor não mexer

  const promovido = artistas[real]!;
  return [promovido, ...artistas.filter((_, i) => i !== real)];
}
