/**
 * /artistas — every artist across your library, most tracks first. Tapping one
 * opens their page (/artista/:name) with all their songs and albums.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import { VirtualList } from '@/components/media/VirtualList';
import * as localLibrary from '@/lib/local/localLibrary';

const EMPTY: ReturnType<typeof localLibrary.list> = [];

/**
 * Colunas da grade por largura — os mesmos pontos do Tailwind que a grade usava
 * (`grid-cols-3 sm:4 md:5 lg:6`: 640 / 768 / 1024 px). A grade é virtualizada
 * POR LINHA, então o número de colunas precisa ser conhecido em JS.
 */
const PONTOS: ReadonlyArray<readonly [string, number]> = [
  ['(min-width: 1024px)', 6],
  ['(min-width: 768px)', 5],
  ['(min-width: 640px)', 4],
];

function colunasParaLargura(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 3;
  for (const [consulta, colunas] of PONTOS) {
    if (window.matchMedia(consulta).matches) return colunas;
  }
  return 3;
}

function assinarLargura(avisar: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const listas = PONTOS.map(([consulta]) => window.matchMedia(consulta));
  for (const l of listas) l.addEventListener?.('change', avisar);
  return () => {
    for (const l of listas) l.removeEventListener?.('change', avisar);
  };
}

/** Parte a lista em linhas de `n` itens (a última pode ter menos). */
function emLinhas<T>(itens: readonly T[], n: number): T[][] {
  const linhas: T[][] = [];
  for (let i = 0; i < itens.length; i += n) linhas.push(itens.slice(i, i + n));
  return linhas;
}

export default function ArtistsPage() {
  // Re-render whenever the library changes; artists() derives from it.
  useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const artists = localLibrary.artists();
  const colunas = useSyncExternalStore(assinarLargura, colunasParaLargura, () => 3);
  const linhas = useMemo(() => emLinhas(artists, colunas), [artists, colunas]);

  return (
    <div className="space-y-6 py-4">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
        <Users className="size-7 text-fg-muted" /> Artistas
      </h1>

      {artists.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum artista ainda"
          description="Importe ou adicione músicas — os artistas aparecem aqui automaticamente."
        />
      ) : (
        // GRADE VIRTUALIZADA por linha: com ~3 mil artistas eram 19 mil nós e
        // milhares de pedidos de foto (cada cartão busca a foto do artista).
        // Agora só as linhas que cabem na tela existem — e só elas buscam foto.
        // `dynamic`: o subtítulo pode quebrar em duas linhas, a altura varia.
        <VirtualList
          items={linhas}
          estimateSize={colunas >= 5 ? 247 : 231}
          overscan={3}
          dynamic
          renderItem={(linha) => (
            <div
              role="listitem"
              className="grid gap-3 pb-3"
              style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}
            >
              {linha.map((artist) => (
                <LocalArtistCard
                  key={artist.name}
                  name={artist.name}
                  trackCount={artist.trackCount}
                  fallbackImage={artist.coverUrl}
                />
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}
