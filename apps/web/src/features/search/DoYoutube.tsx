/**
 * "Do YouTube" — a busca não para no que já está no acervo.
 *
 * Quando a pessoa procura uma música que ninguém importou, a tela ficava em
 * "Nada encontrado" e o caminho era sair, achar o link em outro lugar e colar.
 * Aqui o importador pesquisa no YouTube (`GET /buscar-youtube`) e cada
 * resultado dá para OUVIR NA HORA (stream ao vivo, sem baixar) ou GUARDAR (a
 * fila de import de sempre, que baixa, põe na biblioteca e manda para o cofre).
 *
 * Automático só quando o acervo achou pouco: pesquisar no YouTube custa uma
 * chamada do yt-dlp no servidor, e quem já achou a música não precisa disso.
 * Nos outros casos fica um botão — a pessoa pede se quiser.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, LogIn, Plus, RotateCcw, Youtube } from 'lucide-react';
import { toast } from 'sonner';
import { PlayButton } from '@/components/media/PlayButton';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  aquecerFontes,
  buscarNoYoutube,
  faixaDoYoutube,
  videoIdDoYoutube,
  type ResultadoYoutube,
} from '@/lib/local/importerHelper';
import * as importQueue from '@/lib/local/importQueue';
import * as localLibrary from '@/lib/local/localLibrary';
import { cn, formatTime } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackDto } from '@radinho/shared';

const SEM_ITENS: importQueue.ImportItem[] = [];
const SEM_RESULTADOS: ResultadoYoutube[] = [];
/** Espera o dedo parar: cada tecla na barra de cima troca o `q` da URL. */
const PAUSA_DE_DIGITACAO_MS = 700;

function useTermoAssentado(termo: string): string {
  const [assentado, setAssentado] = useState(termo);
  useEffect(() => {
    const t = setTimeout(() => setAssentado(termo), PAUSA_DE_DIGITACAO_MS);
    return () => clearTimeout(t);
  }, [termo]);
  return assentado;
}

/** Botão de guardar, com o estado que a fila de import sabe daquele link. */
function BotaoGuardar({ url, itens }: { url: string; itens: importQueue.ImportItem[] }) {
  const item = itens.findLast((i) => i.url === url);
  const jaTem = item?.status === 'done' || localLibrary.findBySource(url) !== null;
  const base =
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors';

  if (jaTem) {
    return (
      <span className={cn(base, 'text-accent')}>
        <Check className="size-3.5" /> Na biblioteca
      </span>
    );
  }
  if (item?.status === 'pending' || item?.status === 'downloading') {
    return (
      <span className={cn(base, 'text-fg-muted')}>
        <Loader2 className="size-3.5 animate-spin" />
        {item.status === 'pending' ? 'Na fila' : 'Baixando'}
      </span>
    );
  }
  if (item?.status === 'error') {
    return (
      <button
        type="button"
        onClick={() => importQueue.retry(item.id)}
        className={cn(base, 'bg-fg/5 text-fg hover:bg-fg/10')}
        title={item.error}
      >
        <RotateCcw className="size-3.5" /> Tentar de novo
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        importQueue.enqueue(url);
        toast.success('Indo para a sua biblioteca', {
          description: 'Baixa em segundo plano — pode continuar ouvindo.',
        });
      }}
      className={cn(base, 'bg-fg/5 text-fg hover:bg-fg/10')}
    >
      <Plus className="size-3.5" />
      <span className="hidden sm:inline">Adicionar à biblioteca</span>
      <span className="sm:hidden">Adicionar</span>
    </button>
  );
}

export function DoYoutube({ termo, automatico }: { termo: string; automatico: boolean }) {
  const { user, loading: carregandoConta } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const assentado = useTermoAssentado(termo);
  // Pedido à mão vale só para o termo em que foi feito.
  const [pedidoPara, setPedidoPara] = useState<string | null>(null);
  const ativo = automatico || pedidoPara === assentado;

  const itens = useSyncExternalStore(importQueue.subscribe, importQueue.list, () => SEM_ITENS);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const alternar = usePlayerStore((s) => s.toggle);
  const [preparando, setPreparando] = useState<string | null>(null);

  const busca = useQuery({
    queryKey: ['buscar-youtube', assentado.toLowerCase()],
    queryFn: ({ signal }) => buscarNoYoutube(assentado, signal),
    enabled: logado && ativo && assentado.length >= 2 && assentado === termo,
    // O servidor guarda 10 min; o cliente não precisa perguntar de novo antes.
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const resultados = busca.data?.ok ? busca.data.resultados : SEM_RESULTADOS;

  // Adianta a extração dos primeiros: é o que faz o play responder em menos de
  // um segundo em vez de 10-17 s (ver `aquecerFontes`). Só dois — cada um é um
  // yt-dlp no servidor, e o resto quase nunca é tocado.
  useEffect(() => {
    if (resultados.length > 0) void aquecerFontes(resultados.slice(0, 2).map((r) => r.url));
  }, [resultados]);

  if (!termo) return null;

  const tocar = async (indice: number): Promise<void> => {
    const alvo = resultados[indice];
    if (!alvo || preparando) return;
    // Já está na biblioteca deste aparelho: toca a cópia, não o YouTube.
    const guardada = localLibrary.findBySource(alvo.url);
    if (guardada) {
      playQueue([guardada], 0, { source: 'search', sourceId: termo });
      return;
    }
    setPreparando(alvo.url);
    try {
      // A fila leva TODOS os resultados — uma fila de uma faixa só pararia no
      // fim da música, como já acontecia na busca por letra.
      const faixas = await Promise.all(resultados.map((r) => faixaDoYoutube(r)));
      const tocaveis = faixas.filter((f): f is TrackDto => f !== null);
      const inicio = tocaveis.findIndex((f) => f.id === `youtube:${videoIdDoYoutube(alvo.url)}`);
      if (inicio < 0) {
        toast.error('Entre na sua conta para ouvir músicas do YouTube.');
        return;
      }
      playQueue(tocaveis, inicio, { source: 'search', sourceId: `youtube:${termo}` });
    } finally {
      setPreparando(null);
    }
  };

  const cabecalho = (
    <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
      <Youtube className="size-5 text-fg-muted" /> Do YouTube
    </h2>
  );

  if (!carregandoConta && !logado) {
    return (
      <section aria-label="Do YouTube" className="min-w-0">
        {cabecalho}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-fg-muted">
            Não achou? Entre na sua conta para buscar essa música no YouTube, ouvir na hora e
            guardar na sua biblioteca.
          </p>
          <Link
            to="/login"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg"
          >
            <LogIn className="size-4" /> Entrar
          </Link>
        </div>
      </section>
    );
  }

  if (!ativo) {
    return (
      <button
        type="button"
        onClick={() => setPedidoPara(assentado)}
        className="inline-flex items-center gap-2 rounded-full bg-fg/5 px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg"
      >
        <Youtube className="size-4" /> Não achou? Buscar “{termo}” no YouTube
      </button>
    );
  }

  const esperando = assentado !== termo || busca.isLoading || carregandoConta;

  return (
    <section aria-label="Do YouTube" className="min-w-0">
      {cabecalho}
      {esperando ? (
        <div className="space-y-2" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : busca.data && !busca.data.ok ? (
        <p className="rounded-xl border border-border bg-bg-elevated p-4 text-sm text-fg-muted">
          {busca.data.motivo === 'login'
            ? 'Sua conta não tem acesso à busca no YouTube. Entre de novo e tente outra vez.'
            : busca.data.motivo === 'limite'
              ? 'Muitas buscas seguidas. Espere alguns segundos e tente de novo.'
              : 'Não deu para buscar no YouTube agora. Tente de novo daqui a pouco.'}
        </p>
      ) : resultados.length === 0 ? (
        <p className="text-sm text-fg-muted">Nada no YouTube que pareça essa música.</p>
      ) : (
        <ul className="space-y-0.5">
          {resultados.map((r: ResultadoYoutube, indice) => {
            const id = `youtube:${videoIdDoYoutube(r.url)}`;
            const ativa = currentTrack?.id === id;
            return (
              <li
                key={r.url}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-fg/5',
                  ativa && 'bg-fg/5',
                )}
              >
                <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-fg/6 sm:w-24">
                  {r.capa && (
                    <img src={r.capa} alt="" loading="lazy" className="size-full object-cover" />
                  )}
                  {r.duracaoSeg > 0 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] font-medium tabular-nums text-white">
                      {formatTime(r.duracaoSeg)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'line-clamp-2 text-sm font-medium',
                      ativa ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {r.titulo}
                  </span>
                  <span className="line-clamp-1 text-[13px] text-fg-muted">{r.canal}</span>
                </span>
                <BotaoGuardar url={r.url} itens={itens} />
                <PlayButton
                  size="sm"
                  aria-label={`Tocar ${r.titulo}`}
                  playing={ativa && isPlaying}
                  carregando={preparando === r.url}
                  // A que já está tocando pausa/retoma — recomeçar do zero
                  // pagaria de novo a extração ao vivo.
                  onClick={() => (ativa ? alternar() : void tocar(indice))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
