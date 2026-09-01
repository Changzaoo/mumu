/**
 * O DONO ÚNICO DAS ALÇAS DE BLOB — e por que o teto agora é em BYTES.
 *
 * `URL.createObjectURL` não devolve um endereço: devolve uma ALÇA que segura o
 * arquivo inteiro vivo até alguém soltar. Nenhuma API de memória do navegador
 * conta esses bytes (eles moram no processo do navegador, não no heap de JS), e
 * é por isso que este app já conviveu com "o heap está em 12 MB" e "a aba está
 * em 1,4 GB" ao mesmo tempo.
 *
 * ── O ERRO QUE ESTE MÓDULO CONSERTA ──
 *
 * Havia DOIS mapas de alças, copiados um do outro (`localLibrary` e
 * `downloadManager`), cada um com o mesmo teto: 60 alças abertas. Contagem não
 * é tamanho. Sessenta alças são 60 MB numa biblioteca de podcast e 2,4 GB numa
 * de FLAC — o mesmo código, o mesmo "teto respeitado", quarenta vezes a
 * memória. O teto contava a coisa errada.
 *
 * Pior: por serem dois mapas, cada um respeitava o próprio limite sem saber do
 * outro. Os dois cheios eram 120 alças, e ninguém no app conseguia responder
 * "quanto a aba está segurando" — porque a resposta não existia em lugar nenhum.
 *
 * Aqui a conta é uma só, em bytes, e é consultável (`relatorio()`).
 *
 * ── POR QUE EXISTE UM MÍNIMO DE ALÇAS ──
 *
 * Soltar a alça do áudio que está tocando emudece a música na hora. A ordem do
 * `Map` é a de inserção e `lembrar`/`consultar` reinserem a cada uso, então as
 * primeiras chaves são sempre as menos usadas recentemente — a faixa tocando e
 * a pré-carregada, últimas a entrar, jamais estão na ponta descartada. O mínimo
 * é o cinto de segurança disso: mesmo que UMA faixa sozinha estoure o teto de
 * bytes (um FLAC de 300 MB existe), o despejo para antes de chegar nela.
 */

/** Cofres de alça. Separados porque têm donos e orçamentos diferentes. */
export type Cofre = 'audio' | 'capa';

interface Politica {
  /** Teto de bytes segurados ao mesmo tempo. É o limite que importa. */
  tetoBytes: number;
  /** Teto de alças. Segundo limite, contra multidões de arquivos minúsculos. */
  tetoAlcas: number;
  /**
   * Nunca despeja abaixo disto, NEM QUE ESTOURE `tetoBytes` — e a precedência
   * é proposital: emudecer a música que está tocando para respeitar um número
   * seria trocar um problema invisível por um audivelmente pior.
   *
   * Na prática o piso só vence com arquivos enormes, e nesse caso ele é
   * exatamente o que se quer: ninguém deveria reler 300 MB do disco por ter
   * apertado "voltar uma faixa".
   */
  minimoAlcas: number;
}

/**
 * OS ORÇAMENTOS, e o raciocínio de cada número.
 *
 * `audio`: 128 MB cobre com folga a faixa tocando, a pré-carregada e um punhado
 * de recentes para voltar atrás na fila sem reabrir arquivo. Reabrir uma alça
 * descartada é barato — os bytes continuam no cofre em disco, só a alça saiu.
 * O piso de 3 é o conjunto de trabalho real do player: a anterior, a atual e a
 * próxima.
 *
 * `capa`: 64 MB. Com as capas guardadas como miniatura (ver `miniaturaDeCapa`),
 * isso são milhares de capas — na prática o teto nunca é alcançado por uma
 * biblioteca normal, e existe como fundo de poço para a biblioteca patológica,
 * onde mostrar o ícone padrão é estritamente melhor que comer um giga de RAM.
 */
const POLITICAS: Record<Cofre, Politica> = {
  audio: { tetoBytes: 128_000_000, tetoAlcas: 60, minimoAlcas: 3 },
  capa: { tetoBytes: 64_000_000, tetoAlcas: 600, minimoAlcas: 32 },
};

interface Alca {
  url: string;
  bytes: number;
}

const cofres: Record<Cofre, Map<string, Alca>> = {
  audio: new Map(),
  capa: new Map(),
};

const bytesEmUso: Record<Cofre, number> = { audio: 0, capa: 0 };

/**
 * Quem quer saber que uma alça foi despejada.
 *
 * Existe porque despejar não é invisível: quem guardou a URL num objeto de
 * estado (o `coverUrl` de uma faixa, por exemplo) ficaria apontando para uma
 * alça revogada, e a tela mostraria imagem quebrada em vez do ícone padrão.
 * O dono precisa saber para limpar a referência dele.
 */
const ouvintesDeDespejo: Record<Cofre, Set<(chave: string) => void>> = {
  audio: new Set(),
  capa: new Set(),
};

export function aoDespejar(cofre: Cofre, ouvinte: (chave: string) => void): () => void {
  ouvintesDeDespejo[cofre].add(ouvinte);
  return () => ouvintesDeDespejo[cofre].delete(ouvinte);
}

function revogar(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ambiente sem URL (teste em Node) — nada a soltar */
  }
}

/** Solta as alças mais antigas até caber no orçamento. */
function despejar(cofre: Cofre): void {
  const { tetoBytes, tetoAlcas, minimoAlcas } = POLITICAS[cofre];
  const mapa = cofres[cofre];

  while (mapa.size > minimoAlcas && (bytesEmUso[cofre] > tetoBytes || mapa.size > tetoAlcas)) {
    const maisAntiga = mapa.keys().next();
    if (maisAntiga.done) break;
    const chave = maisAntiga.value;
    const alca = mapa.get(chave);
    mapa.delete(chave);
    if (!alca) continue;
    bytesEmUso[cofre] -= alca.bytes;
    revogar(alca.url);
    for (const ouvinte of ouvintesDeDespejo[cofre]) ouvinte(chave);
  }
}

/**
 * Registra uma alça já criada. Reinserir conta como uso (vai para o fim da
 * fila), que é o que torna a ordem do `Map` uma ordem de menos-usado-primeiro.
 */
function lembrar(cofre: Cofre, chave: string, url: string, bytes: number): void {
  const antiga = cofres[cofre].get(chave);
  if (antiga) {
    bytesEmUso[cofre] -= antiga.bytes;
    // Mesma chave com URL nova: a antiga vira lixo se não for solta agora.
    if (antiga.url !== url) revogar(antiga.url);
  }
  cofres[cofre].delete(chave); // reposiciona no fim (mais recente)
  cofres[cofre].set(chave, { url, bytes });
  bytesEmUso[cofre] += bytes;
  despejar(cofre);
}

/** Abre a alça do blob e passa a segurá-la sob o orçamento do cofre. */
export function abrir(cofre: Cofre, chave: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  lembrar(cofre, chave, url, blob.size);
  return url;
}

/**
 * A alça já aberta, ou null. Consultar CONTA COMO USO — sem isso, a capa que
 * está na tela há uma hora seria a primeira candidata a despejo.
 *
 * `null` aqui não significa "não existe": significa "não está aberta agora".
 * Quem quer saber se os bytes existem pergunta ao cofre em disco.
 */
export function consultar(cofre: Cofre, chave: string): string | null {
  const alca = cofres[cofre].get(chave);
  if (!alca) return null;
  cofres[cofre].delete(chave);
  cofres[cofre].set(chave, alca); // marca como recém-usada
  return alca.url;
}

/** Solta a alça desta chave, se houver. Não avisa os ouvintes: quem chama sabe. */
export function soltar(cofre: Cofre, chave: string): void {
  const alca = cofres[cofre].get(chave);
  if (!alca) return;
  cofres[cofre].delete(chave);
  bytesEmUso[cofre] -= alca.bytes;
  revogar(alca.url);
}

/**
 * O orçamento deste cofre já está no teto?
 *
 * Serve para quem abre alças EM LOTE parar antes de começar a se atropelar. A
 * restauração de capas no boot é o caso: sem esta pergunta ela abria uma alça
 * por faixa da biblioteca inteira e o próprio laço despejava a maioria delas
 * logo em seguida — milhares de leituras de disco e milhares de despejos para
 * terminar exatamente no mesmo lugar onde teria terminado parando na hora.
 */
export function orcamentoCheio(cofre: Cofre): boolean {
  const { tetoBytes, tetoAlcas } = POLITICAS[cofre];
  return bytesEmUso[cofre] >= tetoBytes || cofres[cofre].size >= tetoAlcas;
}

export interface RelatorioDeAlcas {
  audio: { alcas: number; bytes: number };
  capa: { alcas: number; bytes: number };
  totalBytes: number;
}

/**
 * Quanto a aba está segurando AGORA, por cofre.
 *
 * Fica ligado em produção de propósito, pelo mesmo motivo do `radinhoPerf()`:
 * na próxima vez que alguém disser "está comendo memória", a evidência já está
 * lá — e é a única fonte, porque nenhuma API do navegador conta estes bytes.
 */
export function relatorio(): RelatorioDeAlcas {
  return {
    audio: { alcas: cofres.audio.size, bytes: bytesEmUso.audio },
    capa: { alcas: cofres.capa.size, bytes: bytesEmUso.capa },
    totalBytes: bytesEmUso.audio + bytesEmUso.capa,
  };
}

/** Só para teste: esvazia os dois cofres. */
export function esquecerTudo(): void {
  for (const cofre of ['audio', 'capa'] as const) {
    for (const alca of cofres[cofre].values()) revogar(alca.url);
    cofres[cofre].clear();
    bytesEmUso[cofre] = 0;
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { radinhoMemoria: () => RelatorioDeAlcas }).radinhoMemoria = relatorio;
}
