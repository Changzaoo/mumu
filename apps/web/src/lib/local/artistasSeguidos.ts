/**
 * ARTISTAS QUE A PESSOA SEGUE — o "curtir artista" do app.
 *
 * O `useFollowArtist` de features/artists fala com o catálogo do servidor
 * (`/artists/:id/follow`), que só conhece artistas com id de catálogo. A ficha
 * que a pessoa abre de verdade é a do ACERVO (`/artista/:nome`), identificada
 * pelo nome — e é essa que precisa de "Seguir". Daí esta loja, irmã de
 * `localLikes`: lista local, ordem do mais recente, e sincronizada entre
 * aparelhos pela mesma via (`serverCollection`, fila em disco antes da rede).
 *
 * A CHAVE É A IDENTIDADE, NÃO A GRAFIA. "DJ Kennedi" e "Kennedi" são a mesma
 * pessoa para a ficha (ver `artistIdentity`); seguir numa grafia e procurar na
 * outra não pode dar "não segue". Por isso o id do documento é a chave de
 * identidade, e o nome guardado é só o que se mostra.
 *
 * Quem aparece na lateral como círculo é quem está aqui (Sidebar).
 */
import { serverCollection } from '@/lib/sync/serverCollection';
import { gravarLocal } from '@/lib/local/cofreLocal';
import { artistIdentityKey } from '@/lib/local/artistIdentity';

const CHAVE = 'aurial:artistas-seguidos';

export interface ArtistaSeguido {
  /** Grafia mostrada — a que a pessoa estava vendo quando seguiu. */
  nome: string;
  /** Capa de reserva enquanto a foto de verdade não chega (nunca `blob:`). */
  capaUrl: string | null;
  /** ISO de quando passou a seguir — ordena a lateral, mais recente em cima. */
  seguidoEm: string;
}

type Mapa = Record<string, ArtistaSeguido>;

let cache: Mapa | null = null;
let listaCache: ArtistaSeguido[] | null = null;
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

/** A chave de um nome — a mesma que agrupa a ficha do artista. */
export function chaveDoArtista(nome: string): string {
  return artistIdentityKey(nome) || nome.trim().toLowerCase();
}

function valido(v: unknown): v is ArtistaSeguido {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ArtistaSeguido).nome === 'string' &&
    (v as ArtistaSeguido).nome.trim() !== ''
  );
}

function ler(): Mapa {
  if (cache) return cache;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : {};
    const limpo: Mapa = {};
    if (lido && typeof lido === 'object') {
      for (const [id, v] of Object.entries(lido as Record<string, unknown>)) {
        if (valido(v)) limpo[id] = v;
      }
    }
    cache = limpo;
  } catch {
    cache = {};
  }
  return cache;
}

// Seguir é escolha da pessoa, não cache: mesma cota protegida das curtidas.
// Ver lib/local/cofreLocal.ts.
function gravar(proximo: Mapa): void {
  cache = proximo;
  listaCache = null;
  gravarLocal(CHAVE, JSON.stringify(proximo));
  emitir();
}

/**
 * Seguidos, do mais recente ao mais antigo. Referência ESTÁVEL entre mudanças
 * — é o `getSnapshot` do `useSyncExternalStore` da lateral.
 */
export function list(): ArtistaSeguido[] {
  if (listaCache) return listaCache;
  listaCache = Object.values(ler()).sort((a, b) => b.seguidoEm.localeCompare(a.seguidoEm));
  return listaCache;
}

export function segue(nome: string): boolean {
  const id = chaveDoArtista(nome);
  return id !== '' && id in ler();
}

/** URL de objeto morre com a aba: gravá-la seria gravar uma capa quebrada. */
function capaDuravel(url: string | null | undefined): string | null {
  return url && !url.startsWith('blob:') ? url : null;
}

// Aplicadores só locais (usados pela sincronia — não podem re-enviar).
function aplicarSeguir(id: string, artista: ArtistaSeguido): void {
  const atual = ler()[id];
  if (
    atual &&
    atual.nome === artista.nome &&
    atual.capaUrl === artista.capaUrl &&
    atual.seguidoEm === artista.seguidoEm
  ) {
    return;
  }
  gravar({ ...ler(), [id]: artista });
}

function aplicarDeixar(id: string): void {
  if (!(id in ler())) return;
  const proximo = { ...ler() };
  delete proximo[id];
  gravar(proximo);
}

const nuvem = serverCollection<ArtistaSeguido>({
  // 'artistas' está na lista fechada de
  // apps/api/src/modules/collections/collections.controller.ts. Até a API subir
  // com ela, a escrita espera na fila em disco — seguir funciona igual aqui.
  name: 'artistas',
  localItems: () => Object.entries(ler()),
  onRemoteUpsert: (id, dado) => {
    if (valido(dado)) aplicarSeguir(id, dado);
  },
  onRemoteDelete: (id) => aplicarDeixar(id),
});

/** Começa/para a sincronia entre aparelhos (chamado na troca de conta). */
export const setUser = nuvem.setUser;

export function seguir(nome: string, capaUrl?: string | null): void {
  const limpo = nome.trim();
  const id = chaveDoArtista(limpo);
  if (!id || id in ler()) return;
  const artista: ArtistaSeguido = {
    nome: limpo,
    capaUrl: capaDuravel(capaUrl),
    seguidoEm: new Date().toISOString(),
  };
  aplicarSeguir(id, artista);
  nuvem.push(id, artista);
}

export function deixarDeSeguir(nome: string): void {
  const id = chaveDoArtista(nome);
  if (!id || !(id in ler())) return;
  aplicarDeixar(id);
  nuvem.remove(id);
}

export function alternar(nome: string, capaUrl?: string | null): boolean {
  if (segue(nome)) {
    deixarDeSeguir(nome);
    return false;
  }
  seguir(nome, capaUrl);
  return true;
}
