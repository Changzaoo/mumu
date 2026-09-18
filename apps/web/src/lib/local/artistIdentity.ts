/**
 * QUEM É QUEM — uma pessoa, um artista, por mais que escrevam o nome de jeitos
 * diferentes.
 *
 * A biblioteca vem de tags de arquivo, de importação por link e de catálogos
 * que não combinaram entre si. O mesmo artista chega como "DJ Kennedi" numa
 * faixa e "Kennedi" na outra; "Brandão", "Brandao" e "MC Brandão"; "Fulano
 * Oficial" e "Fulano - Topic" (o nome que o YouTube inventa). Como o
 * agrupamento comparava o nome quase cru, cada grafia virava um artista: a
 * estante mostrava duas fichas da mesma pessoa, cada uma com metade das faixas.
 *
 * A chave de identidade abaixo é o que faz todas essas grafias caírem no mesmo
 * lugar. Ela joga fora o que é ENFEITE do nome, não o nome:
 *  • acento e pontuação ("Brandão" = "Brandao" = "D.J." = "DJ");
 *  • o papel na frente ("DJ", "MC", "Mr.", "The", "O"/"Os") — é como a pessoa é
 *    anunciada, não como ela se chama;
 *  • o carimbo de canal no fim ("Oficial", "Official", "VEVO", "- Topic");
 *  • o espaço entre as palavras ("DJ Kennedi" = "djkennedi").
 *
 * O LIMITE, que importa tanto quanto a regra: tirar o papel encurta o nome, e
 * nome curto colide fácil — "MC B" viraria "b" e engoliria qualquer "B". Por
 * isso a versão encurtada só vale a partir de quatro caracteres; abaixo disso
 * o artista continua com a identidade do nome inteiro. Fundir errado é pior do
 * que não fundir: junta duas pessoas e não há como o usuário desfazer.
 */

/** Minúsculas, sem acento, só letra/número — a mesma base do resto da lib. */
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
 * A identidade de um nome de artista. Duas grafias com a MESMA chave são a
 * mesma pessoa para todos os efeitos da biblioteca: ficha, faixas e álbuns.
 */
export function artistIdentityKey(name: string): string {
  const base = normalizar(name);
  if (!base) return '';
  const inteiro = base.replace(/ /g, '');

  // "D.J. Kennedi" chega aqui como "d j kennedi": a pontuação virou espaço e o
  // papel virou duas letras soltas. Iniciais vizinhas voltam a ser uma palavra
  // antes da poda, senão "d" e "j" não são reconhecidos como papel nenhum.
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
  // O papel também vem colado ("djkennedi", exportado assim por alguns sites).
  // Aqui a poda exige uma cauda de CINCO letras, não quatro: sem o espaço não
  // há como distinguir o papel do começo de um nome, e nomes curtos que
  // começam por acaso com "dj"/"mc" — Djavan, Djonga, Mcfly — ficam de fora
  // por isso. Errar aqui juntaria duas pessoas sem volta.
  if (partes.length === 1) {
    const colado = /^(dj|djs|mc|mcs|mr|mrs|dr|sr|sra)(.{5,})$/.exec(curto);
    if (colado) curto = colado[2] as string;
  }
  // Nome curto demais depois da poda volta a valer inteiro: o risco de juntar
  // duas pessoas diferentes é maior que o de deixar duas fichas de uma só.
  return curto.length >= 4 ? curto : inteiro;
}

/**
 * Qual das grafias fica na ficha. Ganha quem aparece em mais faixas — é a forma
 * que o usuário vê o tempo todo; no empate fica a mais completa ("DJ Kennedi"
 * em vez de "Kennedi"), que diz mais e nunca diz menos. Em último caso, quem
 * tem maiúsculas ganha de quem está todo em minúsculo.
 */
export function melhorGrafia(
  atual: { name: string; trackCount: number },
  candidato: { name: string; trackCount: number },
): string {
  if (candidato.trackCount !== atual.trackCount) {
    return candidato.trackCount > atual.trackCount ? candidato.name : atual.name;
  }
  if (candidato.name.length !== atual.name.length) {
    return candidato.name.length > atual.name.length ? candidato.name : atual.name;
  }
  const atualMinuscula = atual.name === atual.name.toLowerCase();
  const candidatoMinuscula = candidato.name === candidato.name.toLowerCase();
  if (atualMinuscula && !candidatoMinuscula) return candidato.name;
  return atual.name;
}
