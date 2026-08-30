/**
 * OS ÁLBUNS QUE A PESSOA MANDOU GUARDAR.
 *
 * O download é automático (ver `lib/offline/guardiaoOffline`): o app baixa o
 * que você vai ouvir a seguir e depois vai preenchendo o resto da biblioteca,
 * respeitando a cota do aparelho. Isso resolve o caso comum e deixa um de fora
 * — o único que a automação não tem como adivinhar: **o disco que você quer ter
 * garantido antes de ficar sem sinal.**
 *
 * A fila do player responde "o que vem agora"; o histórico responde "o que você
 * ouve sempre". Nenhum dos dois responde "vou viajar amanhã e quero ESTE álbum
 * comigo". É a única decisão que precisa de uma pessoa, e por isso é a única
 * coisa manual que sobra na interface — o botão de baixar faixa por faixa saiu
 * justamente porque a automação já cobre aquilo.
 *
 * FIXAR NÃO BAIXA NA HORA. Marcar um álbum o coloca no TOPO da fila do
 * guardião, logo depois do que está tocando. Quem baixa continua sendo o
 * guardião, com o mesmo respiro entre faixas e o mesmo teto de cota — senão
 * marcar um disco de trinta faixas viraria uma rajada em cima de quem está
 * ouvindo, que é exatamente o estrago que o guardião existe para evitar.
 *
 * A marca é DESTE APARELHO. Espaço de armazenamento é local: o celular tem
 * cota apertada, o computador não. Sincronizar isso faria o celular baixar
 * álbuns escolhidos no desktop e encher sozinho.
 */
const CHAVE = 'aurial:albuns-offline';

let cache: Set<string> | null = null;
const ouvintes = new Set<() => void>();

function emitir(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function ler(): Set<string> {
  if (cache) return cache;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    cache = new Set(
      Array.isArray(lido) ? (lido as string[]).filter((x) => typeof x === 'string') : [],
    );
  } catch {
    cache = new Set();
  }
  return cache;
}

function gravar(chaves: Set<string>): void {
  cache = chaves;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify([...chaves]));
  } catch {
    /* cota cheia: a marca vale só nesta sessão, e é melhor que travar a tela */
  }
  emitir();
}

/** Este álbum está marcado para ficar disponível offline? */
export function estaFixado(chaveDoAlbum: string): boolean {
  return ler().has(chaveDoAlbum);
}

export function fixar(chaveDoAlbum: string): void {
  const atual = ler();
  if (atual.has(chaveDoAlbum)) return;
  gravar(new Set([...atual, chaveDoAlbum]));
}

/**
 * Desmarca o álbum.
 *
 * NÃO apaga o áudio já baixado, e isso é deliberado: quem desmarca está dizendo
 * "não precisa mais garantir", não "apague isso agora". Jogar fora os bytes na
 * hora puniria um clique de arrependimento com um download inteiro de novo. O
 * espaço se resolve sozinho pela cota, e a página de Downloads tem o botão de
 * limpar para quem quiser resolver na mão.
 */
export function desfixar(chaveDoAlbum: string): void {
  const atual = ler();
  if (!atual.has(chaveDoAlbum)) return;
  const novo = new Set(atual);
  novo.delete(chaveDoAlbum);
  gravar(novo);
}

export function alternar(chaveDoAlbum: string): boolean {
  const marcado = estaFixado(chaveDoAlbum);
  if (marcado) desfixar(chaveDoAlbum);
  else fixar(chaveDoAlbum);
  return !marcado;
}

/** Todas as chaves marcadas. Leitura estável para `useSyncExternalStore`. */
export function lista(): Set<string> {
  return ler();
}

export function limpar(): void {
  gravar(new Set());
}
