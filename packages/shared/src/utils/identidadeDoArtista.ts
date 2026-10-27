/**
 * QUEM É QUEM — a identidade de um nome de artista, igual no app e na API.
 *
 * O acervo identifica artista por NOME (não há tabela relacional preenchida:
 * `Artist` está vazia em produção, as faixas vivem em `CatalogTrack` como
 * JSON). O app já tinha esta regra em `lib/local/artistIdentity.ts` para
 * agrupar "DJ Kennedi" e "Kennedi" na mesma ficha, e usa a MESMA chave como id
 * do documento de "seguir" (`UserCollectionItem`, coleção `artistas`).
 *
 * O "mundo da música" (agenda, prêmios, créditos) grava fichas por artista no
 * servidor, e precisa chegar à mesma chave que o aparelho — senão quem segue
 * "MC Kevin" não recebe o aviso gravado para "Kevin". Por isso a regra mora
 * aqui, e o app reexporta.
 *
 * A regra joga fora o que é ENFEITE do nome, não o nome:
 *  • acento e pontuação ("Brandão" = "Brandao" = "D.J." = "DJ");
 *  • o papel na frente ("DJ", "MC", "Mr.", "The", "O"/"Os");
 *  • o carimbo de canal no fim ("Oficial", "Official", "VEVO", "- Topic");
 *  • o espaço entre as palavras ("DJ Kennedi" = "djkennedi").
 *
 * O LIMITE: tirar o papel encurta o nome, e nome curto colide fácil — "MC B"
 * viraria "b". A versão encurtada só vale a partir de quatro caracteres;
 * abaixo disso vale o nome inteiro. Fundir errado é pior do que não fundir.
 */

/** Minúsculas, sem acento, só letra/número. */
function normalizar(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Como a pessoa é ANUNCIADA, na frente do nome. */
const PAPEIS = new Set([
  'dj',
  'djs',
  'mc',
  'mcs',
  'mr',
  'mrs',
  'ms',
  'dr',
  'sr',
  'sra',
  'the',
  'o',
  'a',
  'os',
  'as',
  'banda',
  'grupo',
]);

/** Carimbo de canal/lançamento no fim — nunca faz parte do nome. */
const CARIMBOS = new Set(['oficial', 'official', 'vevo', 'topic', 'music', 'musica', 'brasil']);

/**
 * A chave de identidade de um nome de artista. Pura e sem memo: o app embrulha
 * com cache por nome (ver `artistIdentityKey`), a API chama poucas vezes.
 */
export function chaveDeIdentidadeDoArtista(name: string): string {
  const base = normalizar(name);
  if (!base) return '';
  const inteiro = base.replace(/ /g, '');

  // "D.J. Kennedi" chega aqui como "d j kennedi": iniciais vizinhas voltam a
  // ser uma palavra antes da poda, senão "d" e "j" não são papel nenhum.
  const partes = base.split(' ').reduce<string[]>((acc, parte) => {
    const anterior = acc[acc.length - 1];
    if (parte.length === 1 && anterior !== undefined && anterior.length <= 2) {
      acc[acc.length - 1] = anterior + parte;
      return acc;
    }
    acc.push(parte);
    return acc;
  }, []);
  while (partes.length > 1 && PAPEIS.has(partes[0] as string)) partes.shift();
  while (partes.length > 1 && CARIMBOS.has(partes[partes.length - 1] as string)) partes.pop();

  let curto = partes.join('');
  // O papel também vem colado ("djkennedi"). Aqui a poda exige cauda de CINCO
  // letras: Djavan, Djonga e Mcfly ficam de fora por isso.
  if (partes.length === 1) {
    const colado = /^(dj|djs|mc|mcs|mr|mrs|dr|sr|sra)(.{5,})$/.exec(curto);
    if (colado) curto = colado[2] as string;
  }
  return curto.length >= 4 ? curto : inteiro;
}
