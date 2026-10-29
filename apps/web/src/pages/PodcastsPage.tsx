/**
 * /podcasts — podcasts do mundo inteiro.
 *
 * Parada, categorias e busca vêm do diretório público da Apple Podcasts
 * (lib/aoVivo/podcastsAbertos), refeito por eles todo dia: a tela se mantém
 * atualizada sem deploy. Os podcasts cadastrados na API do radinho seguem
 * aparecendo como "Do radinho"; os seguidos ficam no aparelho.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe2, Podcast, Search, X } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { Skeleton } from '@/components/ui/skeleton';
import { usePodcasts } from '@/features/browse/api';
import { usePodcastsSeguidos } from '@/lib/aoVivo/guardados';
import {
  buscarPodcasts,
  CATEGORIAS_DE_PODCAST,
  PAISES_DE_PODCAST,
  paradaDePodcasts,
} from '@/lib/aoVivo/podcastsAbertos';
import { nomeDoPais, paisDoAparelho } from '@/lib/aoVivo/radioBrowser';
import { Desenho } from '@/components/icones/Desenho';
import { cn } from '@/lib/utils';

const CHAVE_PAIS = 'radinho:podcasts:pais';
const GRADE = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

interface CardDePodcast {
  id: string;
  title: string;
  publisher: string;
  coverUrl: string | null;
  episodeCount: number;
}

function lerPais(): string {
  try {
    const salvo = window.localStorage.getItem(CHAVE_PAIS);
    if (salvo) return salvo;
  } catch {
    /* sem armazenamento */
  }
  const doAparelho = paisDoAparelho();
  return (PAISES_DE_PODCAST as readonly string[]).includes(doAparelho) ? doAparelho : 'BR';
}

function Grade({
  podcasts,
  carregando,
  numerar,
}: {
  podcasts: CardDePodcast[] | undefined;
  carregando?: boolean;
  numerar?: boolean;
}) {
  return (
    <div className={GRADE}>
      {podcasts?.map((p, i) => (
        <MediaCard
          key={p.id}
          title={numerar ? `${i + 1}. ${p.title}` : p.title}
          subtitle={
            p.episodeCount > 0 ? `${p.publisher} · ${p.episodeCount} episódios` : p.publisher
          }
          imageUrl={p.coverUrl}
          to={`/podcast/${p.id}`}
          className="w-full"
        />
      ))}
      {carregando &&
        Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="w-full p-3">
            <Skeleton className="aspect-square rounded-lg" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
    </div>
  );
}

function Prateleira({ titulo, podcasts }: { titulo: string; podcasts: CardDePodcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={titulo}>
      <h2 className="text-xl font-semibold tracking-tight text-fg">{titulo}</h2>
      <div className="-mx-1 flex snap-x overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
        {podcasts.map((p) => (
          <MediaCard
            key={p.id}
            title={p.title}
            subtitle={p.publisher}
            imageUrl={p.coverUrl}
            to={`/podcast/${p.id}`}
            className="w-40 shrink-0 snap-start sm:w-48"
          />
        ))}
      </div>
    </section>
  );
}

function useDebounce<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = window.setTimeout(() => setAtrasado(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

export default function PodcastsPage() {
  const [pais, setPais] = useState(lerPais);
  const [categoria, setCategoria] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const termo = useDebounce(texto.trim(), 350);
  const buscando = termo.length >= 2;

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_PAIS, pais);
    } catch {
      /* só nesta visita */
    }
  }, [pais]);

  const seguidos = usePodcastsSeguidos();
  const doRadinho = usePodcasts();

  const parada = useQuery({
    queryKey: ['apple-podcasts', 'parada', pais, categoria],
    staleTime: 60 * 60_000,
    enabled: !buscando,
    queryFn: () => paradaDePodcasts(pais, categoria),
  });
  const busca = useQuery({
    queryKey: ['apple-podcasts', 'busca', termo, pais],
    staleTime: 30 * 60_000,
    enabled: buscando,
    queryFn: () => buscarPodcasts(termo, pais),
  });

  const nomeCategoria = CATEGORIAS_DE_PODCAST.find((c) => c.id === categoria)?.nome;
  const nomePais = nomeDoPais(pais, pais);

  return (
    <div className="space-y-8 py-4">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <Podcast className="size-7 text-fg-muted" /> Podcasts
          </h1>
          <p className="text-sm text-fg-muted">
            Os mais ouvidos de cada país e milhões de programas para buscar — a parada é refeita
            todo dia.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Buscar podcast</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar podcast por nome ou assunto"
              className="h-11 w-full rounded-full border border-border bg-bg-elevated pl-10 pr-10 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
            {texto && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setTexto('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </label>
          <label className="relative sm:w-56">
            <span className="sr-only">País</span>
            <select
              value={pais}
              onChange={(e) => setPais(e.target.value)}
              className="h-11 w-full appearance-none rounded-full border border-border bg-bg-elevated px-4 pr-8 text-sm text-fg focus:border-accent focus:outline-none"
            >
              {PAISES_DE_PODCAST.map((p) => (
                <option key={p} value={p}>
                  {nomeDoPais(p, p)}
                </option>
              ))}
            </select>
            <Globe2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          </label>
        </div>

        {!buscando && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            <Chip ativo={categoria === null} onClick={() => setCategoria(null)}>
              Todos
            </Chip>
            {CATEGORIAS_DE_PODCAST.map((c) => (
              <Chip
                key={c.id}
                ativo={categoria === c.id}
                onClick={() => setCategoria(categoria === c.id ? null : c.id)}
              >
                <Desenho nome={c.icone} className="size-4" /> {c.nome}
              </Chip>
            ))}
          </div>
        )}
      </header>

      {buscando ? (
        <section className="space-y-3" aria-label="Resultado da busca">
          <h2 className="text-xl font-semibold tracking-tight text-fg">“{termo}”</h2>
          {busca.isError && <ErrorState onRetry={() => void busca.refetch()} />}
          <Grade podcasts={busca.data} carregando={busca.isLoading} />
          {busca.isSuccess && busca.data.length === 0 && (
            <EmptyState
              icon={Podcast}
              title="Nenhum podcast encontrado"
              description="Tente outro nome ou assunto."
            />
          )}
        </section>
      ) : (
        <>
          {categoria === null && (
            <>
              <Prateleira titulo="Você segue" podcasts={seguidos} />
              <Prateleira titulo="Do radinho" podcasts={doRadinho.data ?? []} />
            </>
          )}
          <section className="space-y-3" aria-label="Parada">
            <h2 className="text-xl font-semibold tracking-tight text-fg">
              {nomeCategoria ? `Top ${nomeCategoria}` : 'Mais ouvidos'}{' '}
              <span className="text-fg-muted">{nomePais}</span>
            </h2>
            {parada.isError && <ErrorState onRetry={() => void parada.refetch()} />}
            <Grade podcasts={parada.data} carregando={parada.isLoading} numerar />
            {parada.isSuccess && parada.data.length === 0 && (
              <EmptyState
                icon={Podcast}
                title="Parada vazia neste país"
                description="Escolha outra categoria ou outro país."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200',
        ativo
          ? 'border-transparent bg-fg text-bg'
          : 'border-border bg-bg-elevated text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
