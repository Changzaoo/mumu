/**
 * GRAFIA DA LETRA — a palavra certa, escrita do jeito certo, sem trocar de palavra.
 *
 * No funk e no rap o cantor pronuncia "nóis", "mermo", "pobrema", e tanto a letra
 * publicada quanto a transcrição por voz registram o SOM, não a palavra. Aqui
 * cada palavra conhecida volta para a forma padrão. É normalização ortográfica
 * por dicionário, palavra a palavra — NÃO é revisão de texto:
 *
 *   - não mexe em gíria ("mano", "parça"), contração dicionarizada ("tá", "pra",
 *     "né", "cê"), palavrão, nome próprio nem concordância ("nóis vai" vira
 *     "nós vai": só a grafia de "nóis" é corrigida);
 *   - NUNCA muda a quantidade de palavras: cada correção troca um token por
 *     outro token, sem espaço. É isso que mantém intactos os tempos por palavra
 *     (`words`) e o casamento do alinhamento (`temposDasPalavras`);
 *   - na dúvida (palavra que também existe, ou que muda de sentido), fica de
 *     fora — ver "FORA DE PROPÓSITO" no fim do dicionário.
 *
 * Só se aplica na EXIBIÇÃO (LyricsView). O texto no cache, o que vai para o
 * alinhamento, a prova da voz (confirmarPelaVoz) e o aprendizado de vocabulário
 * continuam com o texto original: este último precisa justamente do "ouvido ≠
 * real", e o alinhamento casa palavra por conteúdo com o que o importador ouviu.
 * Como roda na saída, letras que já estão em cache são corrigidas também.
 *
 * Tudo puro (sem DOM, sem rede).
 */
import type { Lyrics, LyricLine } from '@/lib/lyrics/lyrics';

/**
 * Chave (minúscula, exatamente como aparece) → forma padrão (minúscula).
 *
 * Só entra palavra que, em português, NÃO existe com outro sentido. Chaves sem
 * acento ("nao", "voce") só valem porque a regra de idioma abaixo garante que a
 * letra é portuguesa — em inglês e espanhol este dicionário nem roda.
 */
const DICIONARIO: Readonly<Record<string, string>> = {
  // ── fala do cantor, grafia fonética ──────────────────────────────
  nóis: 'nós',
  nois: 'nós',
  mermo: 'mesmo',
  memo: 'mesmo',
  pobrema: 'problema',
  poblema: 'problema',
  probrema: 'problema',
  muié: 'mulher',
  mulé: 'mulher',
  muie: 'mulher',
  véi: 'velho',
  fia: 'filha',
  ocê: 'você',
  ocês: 'vocês',
  tamém: 'também',
  tamem: 'também',
  prantar: 'plantar',
  prantei: 'plantei',
  prantou: 'plantou',
  prantando: 'plantando',
  bicicreta: 'bicicleta',
  framengo: 'flamengo',
  vamo: 'vamos',
  ansim: 'assim',
  dimais: 'demais',
  intão: 'então',
  dispois: 'depois',
  despois: 'depois',
  percisa: 'precisa',
  percisar: 'precisar',
  percisei: 'precisei',
  intendi: 'entendi',
  isquece: 'esquece',
  isquecer: 'esquecer',
  isqueci: 'esqueci',
  ispelho: 'espelho',
  muinto: 'muito',
  bunito: 'bonito',
  dinhero: 'dinheiro',
  dinhêro: 'dinheiro',
  mió: 'melhor',
  pió: 'pior',
  oio: 'olho',
  oios: 'olhos',
  trabaio: 'trabalho',
  trabaiar: 'trabalhar',
  trabaiei: 'trabalhei',
  trabaiou: 'trabalhou',
  arguém: 'alguém',
  arguem: 'alguém',
  argum: 'algum',
  arguma: 'alguma',
  arguns: 'alguns',
  argumas: 'algumas',
  fror: 'flor',
  craro: 'claro',
  grobo: 'globo',
  brusa: 'blusa',
  prá: 'pra',

  // ── infinitivo sem o "r" (só verbo que não existe sem ele) ───────
  // Fora de propósito: "bebê", "rolê", "saí", "partí" (palavras de verdade).
  fazê: 'fazer',
  comê: 'comer',
  querê: 'querer',
  podê: 'poder',
  sabê: 'saber',
  dizê: 'dizer',
  corrê: 'correr',
  vencê: 'vencer',
  esquecê: 'esquecer',
  entendê: 'entender',
  perdê: 'perder',
  conhecê: 'conhecer',
  merecê: 'merecer',
  aprendê: 'aprender',
  sofrê: 'sofrer',
  pegá: 'pegar',
  falá: 'falar',
  cantá: 'cantar',
  tomá: 'tomar',
  mandá: 'mandar',
  ficá: 'ficar',
  chegá: 'chegar',
  voltá: 'voltar',
  dançá: 'dançar',
  jogá: 'jogar',
  beijá: 'beijar',
  andá: 'andar',
  ligá: 'ligar',
  passá: 'passar',
  deixá: 'deixar',
  olhá: 'olhar',
  tentá: 'tentar',
  procurá: 'procurar',
  esperá: 'esperar',
  pensá: 'pensar',
  levá: 'levar',
  gostá: 'gostar',
  chamá: 'chamar',
  tirá: 'tirar',
  puxá: 'puxar',
  mostrá: 'mostrar',
  ganhá: 'ganhar',
  gastá: 'gastar',
  comprá: 'comprar',
  ajudá: 'ajudar',
  acabá: 'acabar',
  tocá: 'tocar',
  sentá: 'sentar',
  matá: 'matar',
  namorá: 'namorar',
  rezá: 'rezar',

  // ── acento e til que a transcrição (ou a letra descuidada) perdeu ─
  // Fora de propósito: "ate", "so", "la", "ja", "e", "to", "ne", "mae"
  // (existem em outras línguas, são nome próprio ou mudam de sentido).
  voce: 'você',
  voces: 'vocês',
  nao: 'não',
  tambem: 'também',
  entao: 'então',
  alem: 'além',
  porem: 'porém',
  ninguem: 'ninguém',
  alguem: 'alguém',
  amanha: 'amanhã',
  irmao: 'irmão',
  coracao: 'coração',
  cancao: 'canção',
  paixao: 'paixão',
  ilusao: 'ilusão',
  emocao: 'emoção',
  atencao: 'atenção',
  razao: 'razão',
  cidadao: 'cidadão',
  prisao: 'prisão',
  ta: 'tá',
};

// FORA DE PROPÓSITO, de propósito (ambíguo ou muda o sentido): "fio" (fio/filho),
// "num" (não / em um), "vei"/"veio" (verbo vir), "to" (to/tô), "mermão" e
// "muleque" (gíria já dicionarizada), "vc"/"pq"/"tbm" (abreviação, não grafia),
// "tamo"/"tava"/"vô" (contração dicionarizada), "inté" (é outra palavra: até),
// "cumpade" (não há forma padrão única).

/** Palavras que, em quantidade, denunciam um texto em português. */
const MARCAS_DE_PORTUGUES = new Set([
  'não', 'nao', 'você', 'voce', 'vocês', 'pra', 'tô', 'tá', 'né', 'cê', 'ocê',
  'nóis', 'nós', 'então', 'entao', 'também', 'tambem', 'muito', 'minha', 'meu',
  'tudo', 'isso', 'pelo', 'pela', 'ainda', 'comigo', 'depois',
]); // prettier-ignore

/**
 * A letra é em português? Sem isso o dicionário roda sobre inglês e espanhol e
 * "ta", "memo", "nao", "fia" viram falsos positivos. Evidência: letra com til
 * ("ã", "õ", "ção") ou várias palavras tipicamente portuguesas — poucas demais
 * e não corrige nada (letra curta demais para ter prova). Letra mista
 * (funk com refrão em inglês) conta como portuguesa; o dicionário só pega
 * grafia que não existe em inglês de qualquer forma, exceto "memo" e "ta".
 */
export function ehLetraEmPortugues(textos: readonly string[]): boolean {
  let marcas = 0;
  let palavras = 0;
  for (const texto of textos) {
    for (const p of texto
      .normalize('NFC')
      .toLowerCase()
      .match(/\p{L}+/gu) ?? []) {
      palavras += 1;
      if (MARCAS_DE_PORTUGUES.has(p) || /[ãõ]/.test(p)) marcas += 1;
    }
  }
  return marcas >= 3 && marcas / Math.max(1, palavras) >= 0.05;
}

/** Reaplica a caixa da palavra original sobre a forma corrigida. */
function comACaixaDe(original: string, correta: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return correta.toUpperCase();
  const inicial = original.charAt(0);
  if (inicial !== inicial.toLowerCase()) return correta.charAt(0).toUpperCase() + correta.slice(1);
  return correta;
}

/** Hífen ou apóstrofo colado em letra: "fazê-lo" é grafia CERTA, não erro. */
const LIGACAO = /[-'’]/;

/**
 * Corrige a grafia de um texto (linha, ou uma palavra com pontuação colada).
 * Não decide idioma — quem chama decide (ver `normalizarLetra`). Preserva
 * espaços, pontuação, caixa inicial e CAIXA ALTA; só troca palavra inteira.
 */
export function corrigirGrafia(texto: string): string {
  // Cabeçalho de seção ("[Refrão: Mano Brown]") não é cantado: nomes ali ficam.
  if (/^\s*\[[^\]]*\]\s*$/.test(texto)) return texto;
  // `\p{M}`: acento solto (texto NFD) faz parte da palavra — sem ele "nóis" viraria
  // "no" + "is" e nunca casaria. `hasOwn`: "constructor" não é chave do dicionário
  // (o objeto herda de Object.prototype e devolveria uma função).
  return texto.replace(/[\p{L}\p{M}]+/gu, (palavra, pos: number) => {
    const chave = palavra.normalize('NFC').toLowerCase();
    const correta = Object.hasOwn(DICIONARIO, chave) ? DICIONARIO[chave] : undefined;
    if (!correta) return palavra;
    const antes = texto.charAt(pos - 1);
    const depois = texto.charAt(pos + palavra.length);
    const proximo = texto.charAt(pos + palavra.length + 1);
    // "fazê-lo", "pegá-la", "d'ocê": já é uma forma composta, não se mexe.
    if (LIGACAO.test(depois) && /\p{L}/u.test(proximo)) return palavra;
    if (LIGACAO.test(antes) && /\p{L}/u.test(texto.charAt(pos - 2))) return palavra;
    return comACaixaDe(palavra, correta);
  });
}

function corrigirLinha(linha: LyricLine): LyricLine {
  const text = corrigirGrafia(linha.text);
  const words = linha.words?.map((w) => {
    const t = corrigirGrafia(w.text);
    return t === w.text ? w : { ...w, text: t };
  });
  const mudouPalavra = words?.some((w, i) => w !== linha.words?.[i]) ?? false;
  if (text === linha.text && !mudouPalavra) return linha;
  return { ...linha, text, ...(words ? { words } : {}) };
}

/**
 * A letra como é EXIBIDA. Mesmo número de linhas, mesmos `timeMs`, mesmas
 * palavras por linha. Devolve o MESMO objeto quando nada muda (a tela não
 * recalcula o que já tinha) e preserva os campos extras (`alinhada`, etc.).
 */
export function normalizarLetra<T extends Lyrics>(letra: T): T;
export function normalizarLetra<T extends Lyrics>(
  letra: T | null | undefined,
): T | null | undefined;
export function normalizarLetra<T extends Lyrics>(
  letra: T | null | undefined,
): T | null | undefined {
  if (!letra || letra.lines.length === 0) return letra;
  if (!ehLetraEmPortugues(letra.lines.map((l) => l.text))) return letra;
  const lines = letra.lines.map(corrigirLinha);
  return lines.some((l, i) => l !== letra.lines[i]) ? { ...letra, lines } : letra;
}
