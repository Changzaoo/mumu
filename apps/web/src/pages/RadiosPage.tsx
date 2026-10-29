/**
 * /radios — rádios ao vivo do mundo inteiro.
 *
 * O catálogo vem direto do Radio Browser (lib/aoVivo/radioBrowser): ~50 mil
 * estações mantidas pela comunidade e checadas todo dia, então a tela se
 * mantém atualizada sozinha — estação nova aparece, estação morta some, sem
 * deploy. Favoritas e recentes ficam no aparelho.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Globe2, Heart, RadioTower, Search, TrendingUp, X } from 'lucide-react';
import type { RadioStationDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PlayButton } from '@/components/media/PlayButton';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { radioToTrack, useRadios } from '@/features/browse/api';
import {
  alternarFavorita,
  marcarRecente,
  useRadiosFavoritas,
  useRadiosRecentes,
} from '@/lib/aoVivo/guardados';
import {
  bandeira,
  buscarRadios,
  contarClique,
  nomeDoPais,
  paisDoAparelho,
  paisesComRadio,
  type BuscaDeRadio,
  type RadioAberta,
} from '@/lib/aoVivo/radioBrowser';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const PAGINA = 60;
const CHAVE_PAIS = 'radinho:radios:pais';

/** Gêneros na nossa língua → tag do Radio Browser. */
const GENEROS: { rotulo: string; tag: string }[] = [
  { rotulo: 'Pop', tag: 'pop' },
  { rotulo: 'Rock', tag: 'rock' },
  { rotulo: 'Notícias', tag: 'news' },
  { rotulo: 'Esportes', tag: 'sports' },
  { rotulo: 'Sertanejo', tag: 'sertanejo' },
  { rotulo: 'MPB', tag: 'mpb' },
  { rotulo: 'Samba e pagode', tag: 'samba' },
  { rotulo: 'Funk', tag: 'funk' },
  { rotulo: 'Gospel', tag: 'gospel' },
  { rotulo: 'Eletrônica', tag: 'electronic' },
  { rotulo: 'Dance', tag: 'dance' },
  { rotulo: 'Hip hop', tag: 'hip hop' },
  { rotulo: 'Jazz', tag: 'jazz' },
  { rotulo: 'Clássica', tag: 'classical' },
  { rotulo: 'Lo-fi', tag: 'lofi' },
  { rotulo: 'Chill', tag: 'chillout' },
  { rotulo: 'Anos 80', tag: '80s' },
  { rotulo: 'Anos 90', tag: '90s' },
  { rotulo: 'Reggae', tag: 'reggae' },
  { rotulo: 'Latina', tag: 'latin' },
  { rotulo: 'Country', tag: 'country' },
  { rotulo: 'Metal', tag: 'metal' },
  { rotulo: 'Blues', tag: 'blues' },
  { rotulo: 'Talk', tag: 'talk' },
];

function lerPaisSalvo(): string {
  try {
    return window.localStorage.getItem(CHAVE_PAIS) ?? paisDoAparelho();
  } catch {
    return paisDoAparelho();
  }
}

function tocarRadio(radio: RadioStationDto): void {
  usePlayerStore.getState().playTrack(radioToTrack(radio), { source: 'radio', sourceId: radio.id });
  if ('countryCode' in radio) {
    marcarRecente(radio as RadioAberta);
    contarClique(radio.id);
  }
}

function Logo({ radio }: { radio: RadioStationDto }) {
  const [quebrou, setQuebrou] = useState(false);
  if (radio.imageUrl && !quebrou) {
    return (
      <img
        src={radio.imageUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setQuebrou(true)}
        className="size-full bg-white object-contain p-2 transition-transform duration-300 ease-out group-hover:scale-[1.03]"
      />
    );
  }
  const iniciais = radio.name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <div className="grid size-full place-items-center bg-gradient-to-br from-accent/25 to-fg/5 text-2xl font-bold text-fg/80">
      {iniciais || <RadioTower className="size-8" />}
    </div>
  );
}

function RadioCard({ radio, className }: { radio: RadioStationDto; className?: string }) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoritas = useRadiosFavoritas();
  const active = currentTrack?.id === `radio:${radio.id}`;
  const aberta = 'countryCode' in radio ? (radio as RadioAberta) : null;
  const favorita = aberta ? favoritas.some((r) => r.id === radio.id) : false;

  const play = (): void => tocarRadio(radio);
  const detalhe = [
    aberta?.countryCode ? bandeira(aberta.countryCode) : null,
    radio.genre,
    aberta?.bitrate ? `${aberta.bitrate} kbps` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ouvir rádio ${radio.name}`}
      onClick={play}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          play();
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-bg-elevated p-3 transition-colors duration-200 hover:bg-fg/5',
        active && 'border-accent/40',
        className,
      )}
    >
      <div className="relative mb-3 aspect-square overflow-hidden rounded-lg bg-fg/6">
        <Logo radio={radio} />
        {active && isPlaying && (
          <Badge variant="danger" className="absolute left-2 top-2 gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
            Ao vivo
          </Badge>
        )}
        {aberta && (
          <button
            type="button"
            aria-label={favorita ? `Tirar ${radio.name} das favoritas` : `Favoritar ${radio.name}`}
            aria-pressed={favorita}
            onClick={(event) => {
              event.stopPropagation();
              alternarFavorita(aberta);
            }}
            className={cn(
              'absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity duration-200',
              favorita
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            <Heart className={cn('size-4', favorita && 'fill-accent text-accent')} />
          </button>
        )}
        <PlayButton
          playing={active && isPlaying}
          onClick={(event) => {
            event.stopPropagation();
            if (active) usePlayerStore.getState().toggle();
            else play();
          }}
          className={cn(
            'absolute bottom-2 right-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-200',
            'group-hover:translate-y-0 group-hover:opacity-100',
            active && 'translate-y-0 opacity-100',
          )}
        />
      </div>
      <p className={cn('line-clamp-1 text-sm font-medium', active ? 'text-accent' : 'text-fg')}>
        {radio.name}
      </p>
      <p className="line-clamp-1 text-[13px] text-fg-muted">
        {detalhe || [radio.genre, radio.country].filter(Boolean).join(' · ') || 'Rádio'}
      </p>
    </div>
  );
}

function CardsCarregando({ quantos = 10 }: { quantos?: number }) {
  return (
    <>
      {Array.from({ length: quantos }, (_, i) => (
        <div key={i} className="rounded-xl border border-border p-3">
          <Skeleton className="mb-3 aspect-square rounded-lg" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </>
  );
}

const GRADE = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

/** Prateleira horizontal (rolagem lateral, como no resto do app). */
function Prateleira({
  titulo,
  icone,
  radios,
  carregando,
  erro,
  aoTentar,
}: {
  titulo: string;
  icone?: ReactNode;
  radios: RadioStationDto[] | undefined;
  carregando?: boolean;
  erro?: boolean;
  aoTentar?: () => void;
}) {
  if (!carregando && !erro && (!radios || radios.length === 0)) return null;
  return (
    <section className="space-y-3" aria-label={titulo}>
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
        {icone}
        {titulo}
      </h2>
      {erro ? (
        <ErrorState onRetry={aoTentar} />
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
          {carregando && !radios
            ? Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="w-36 shrink-0 rounded-xl border border-border p-3 sm:w-44">
                  <Skeleton className="mb-3 aspect-square rounded-lg" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))
            : radios?.map((radio) => (
                <RadioCard
                  key={radio.id}
                  radio={radio}
                  className="w-36 shrink-0 snap-start sm:w-44"
                />
              ))}
        </div>
      )}
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

export default function RadiosPage() {
  const [pais, setPais] = useState<string>(lerPaisSalvo);
  const [genero, setGenero] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const termo = useDebounce(texto.trim(), 350);
  const filtrando = termo.length >= 2 || genero !== null;
  const paisAtivo = pais === 'WORLD' ? null : pais;

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_PAIS, pais);
    } catch {
      /* sem armazenamento: só nesta visita */
    }
  }, [pais]);

  const favoritas = useRadiosFavoritas();
  const recentes = useRadiosRecentes();
  const destaques = useRadios();

  const paises = useQuery({
    queryKey: ['radio-browser', 'paises'],
    staleTime: 24 * 60 * 60_000,
    queryFn: paisesComRadio,
  });

  const maisOuvidas = useQuery({
    queryKey: ['radio-browser', 'top', paisAtivo],
    staleTime: 30 * 60_000,
    enabled: !filtrando,
    queryFn: () => buscarRadios({ pais: paisAtivo, ordem: 'clickcount', limite: 30 }),
  });
  const subindo = useQuery({
    queryKey: ['radio-browser', 'subindo', paisAtivo],
    staleTime: 30 * 60_000,
    enabled: !filtrando,
    queryFn: () => buscarRadios({ pais: paisAtivo, ordem: 'clicktrend', limite: 30 }),
  });
  const mundo = useQuery({
    queryKey: ['radio-browser', 'votadas-mundo'],
    staleTime: 6 * 60 * 60_000,
    enabled: !filtrando,
    queryFn: () => buscarRadios({ ordem: 'votes', limite: 30 }),
  });

  const busca: BuscaDeRadio = { pais: paisAtivo, genero, nome: termo.length >= 2 ? termo : null };
  const resultado = useInfiniteQuery({
    queryKey: ['radio-browser', 'busca', busca],
    enabled: filtrando,
    staleTime: 15 * 60_000,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => buscarRadios({ ...busca, limite: PAGINA, pular: pageParam }),
    // A página volta MENOR que o pedido (repetidas e http saem): o próximo
    // salto é pelo pedido, não pelo que sobrou.
    getNextPageParam: (ultima, todas) => (ultima.length === 0 ? undefined : todas.length * PAGINA),
  });
  const listaFiltrada = useMemo(() => {
    const vistas = new Set<string>();
    return (resultado.data?.pages.flat() ?? []).filter((r) =>
      vistas.has(r.id) ? false : (vistas.add(r.id), true),
    );
  }, [resultado.data]);

  const ondeTexto = paisAtivo ? `em ${nomeDoPais(paisAtivo, paisAtivo)}` : 'no mundo';

  return (
    <div className="space-y-8 py-4">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
            <RadioTower className="size-7 text-fg-muted" /> Rádios
          </h1>
          <p className="text-sm text-fg-muted">
            Estações ao vivo de {paises.data ? `${paises.data.length} países` : 'todo o mundo'},
            atualizadas todo dia pela comunidade do Radio Browser.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Buscar rádio</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar rádio pelo nome (ex.: Jovem Pan, BBC, Antena 1)"
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
          <label className="relative sm:w-64">
            <span className="sr-only">País</span>
            <select
              value={pais}
              onChange={(e) => setPais(e.target.value)}
              className="h-11 w-full appearance-none rounded-full border border-border bg-bg-elevated px-4 pr-8 text-sm text-fg focus:border-accent focus:outline-none"
            >
              <option value="WORLD">🌐 Mundo inteiro</option>
              {!paises.data?.some((p) => p.codigo === pais) && pais !== 'WORLD' && (
                <option value={pais}>
                  {bandeira(pais)} {nomeDoPais(pais, pais)}
                </option>
              )}
              {paises.data?.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {bandeira(p.codigo)} {p.nome} ({p.estacoes.toLocaleString('pt-BR')})
                </option>
              ))}
            </select>
            <Globe2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          </label>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <Chip ativo={genero === null} onClick={() => setGenero(null)}>
            Todas
          </Chip>
          {GENEROS.map((g) => (
            <Chip
              key={g.tag}
              ativo={genero === g.tag}
              onClick={() => setGenero(genero === g.tag ? null : g.tag)}
            >
              {g.rotulo}
            </Chip>
          ))}
        </div>
      </header>

      {filtrando ? (
        <section className="space-y-4" aria-label="Resultado">
          <h2 className="text-xl font-semibold tracking-tight text-fg">
            {termo.length >= 2 ? `“${termo}”` : GENEROS.find((g) => g.tag === genero)?.rotulo}{' '}
            <span className="text-fg-muted">{ondeTexto}</span>
          </h2>
          {resultado.isError && <ErrorState onRetry={() => void resultado.refetch()} />}
          {!resultado.isError && (
            <div className={GRADE}>
              {listaFiltrada.map((radio) => (
                <RadioCard key={radio.id} radio={radio} />
              ))}
              {(resultado.isLoading || resultado.isFetchingNextPage) && <CardsCarregando />}
            </div>
          )}
          {resultado.isSuccess && listaFiltrada.length === 0 && (
            <EmptyState
              icon={RadioTower}
              title="Nenhuma estação encontrada"
              description={
                paisAtivo
                  ? 'Tente outro nome, outro gênero ou troque o país para “Mundo inteiro”.'
                  : 'Tente outro nome ou outro gênero.'
              }
            />
          )}
          {resultado.hasNextPage && listaFiltrada.length > 0 && !resultado.isFetchingNextPage && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void resultado.fetchNextPage()}
                className="h-10 rounded-full border border-border px-6 text-sm font-medium text-fg transition-colors hover:bg-fg/5"
              >
                Carregar mais estações
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <Prateleira
            titulo="Suas favoritas"
            icone={<Heart className="size-5 text-accent" />}
            radios={favoritas}
          />
          <Prateleira titulo="Ouvidas recentemente" radios={recentes} />
          <Prateleira
            titulo={`Mais ouvidas ${ondeTexto}`}
            radios={maisOuvidas.data}
            carregando={maisOuvidas.isLoading}
            erro={maisOuvidas.isError}
            aoTentar={() => void maisOuvidas.refetch()}
          />
          <Prateleira
            titulo={`Subindo agora ${ondeTexto}`}
            icone={<TrendingUp className="size-5 text-fg-muted" />}
            radios={subindo.data?.filter(
              (r) => r.tendencia > 0 && !maisOuvidas.data?.some((m) => m.id === r.id),
            )}
            carregando={subindo.isLoading}
          />
          <Prateleira titulo="Destaques do radinho" radios={destaques.data} />
          <Prateleira
            titulo="Mais votadas no mundo"
            icone={<Globe2 className="size-5 text-fg-muted" />}
            radios={mundo.data}
            carregando={mundo.isLoading}
          />
          {maisOuvidas.isSuccess && maisOuvidas.data.length === 0 && (
            <EmptyState
              icon={RadioTower}
              title={`Nenhuma estação em HTTPS ${ondeTexto}`}
              description="Escolha outro país ou “Mundo inteiro”."
            />
          )}
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
        'h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200',
        ativo
          ? 'border-transparent bg-fg text-bg'
          : 'border-border bg-bg-elevated text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
