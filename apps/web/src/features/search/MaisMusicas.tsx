/**
 * "MAIS MÚSICAS" — a busca não para no que já está no acervo, e a pessoa não
 * precisa saber de onde a música vem.
 *
 * Quando o acervo não tem a música, o importador a procura por baixo
 * (`GET /buscar-youtube`), e cada achado aparece aqui como uma FAIXA qualquer:
 * título e artista limpos, capa, duração — nada de vídeo, canal ou "YouTube".
 * Ao tocar, ela começa na hora pelo `/stream` e, ao mesmo tempo, vai para a
 * fila de import: o importador baixa, guarda no cofre e ela passa a ser uma
 * faixa do acervo como as outras. Da próxima vez, toca a cópia.
 *
 * O que já aparece na tela (as músicas do acervo) não se repete aqui, nem as
 * versões do mesmo vídeo (clipe, áudio, letra) entre si.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/useAuthUser';
import { aquecerFontes, buscarNoYoutube, faixaDoYoutube } from '@/lib/local/importerHelper';
import * as importQueue from '@/lib/local/importQueue';
import * as localLibrary from '@/lib/local/localLibrary';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackDto } from '@radinho/shared';

const SEM_ITENS: importQueue.ImportItem[] = [];
/** Espera o dedo parar: cada tecla na barra de cima troca o `q` da URL. */
const PAUSA_DE_DIGITACAO_MS = 700;
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function useTermoAssentado(termo: string): string {
  const [assentado, setAssentado] = useState(termo);
  useEffect(() => {
    const t = setTimeout(() => setAssentado(termo), PAUSA_DE_DIGITACAO_MS);
    return () => clearTimeout(t);
  }, [termo]);
  return assentado;
}

/** "Mantém" de "Matuê" — a mesma música em qualquer grafia/versão. */
function chaveDaMusica(t: TrackDto): string {
  const norm = (s: string): string =>
    s
      .normalize('NFD')
      .replace(DIACRITICOS, '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(trackArtistNames(t))}|${norm(t.title)}`;
}

/**
 * Versão mexida por terceiros (acelerada, "8D", karaokê, reação…): quem busca
 * "Mantém" quer a música, não o "speed up + grave" de um canal qualquer. Só
 * aparece se a própria busca pedir por ela.
 */
const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|cover|reac(?:t|tion|ting)|reagindo|react|tutorial|aula|remix)\b/i;

/**
 * Resultado da busca por baixo: distingue "não achou nada" de "a fonte caiu"
 * (`falha`/`limite`) — juntar os dois faria quem esbarrou num 429/importador
 * fora do ar ler "confira a grafia", quando o problema não é a busca dele.
 */
interface ResultadoBusca {
  faixas: TrackDto[];
  motivoFalha: 'limite' | 'falha' | null;
}

/** Busca por baixo e monta faixas prontas para tocar; nunca lança. */
async function buscarFaixas(termo: string, signal: AbortSignal): Promise<ResultadoBusca> {
  const busca = await buscarNoYoutube(termo, signal);
  if (!busca.ok) {
    // 'login' já tem tela própria (ver `logado` abaixo) — só falha/limite
    // precisam ser sinalizados aqui como "a fonte caiu", não "vazio".
    return { faixas: [], motivoFalha: busca.motivo === 'login' ? null : busca.motivo };
  }
  const pedeAlterada = VERSAO_ALTERADA.test(termo);
  const faixas = await Promise.all(
    busca.resultados
      .filter((r) => pedeAlterada || !VERSAO_ALTERADA.test(`${r.titulo} ${r.canal}`))
      .map(
        // Já está no acervo deste aparelho: a faixa é a cópia, não o stream.
        (r) => localLibrary.findBySource(r.url) ?? faixaDoYoutube(r),
      ),
  );
  return { faixas: faixas.filter((f): f is TrackDto => f !== null), motivoFalha: null };
}

export function MaisMusicas({
  termo,
  jaNaTela,
  semNadaNoAcervo,
}: {
  termo: string;
  /** Faixas que a busca já mostra acima — não aparecem de novo aqui. */
  jaNaTela: readonly TrackDto[];
  /** O acervo não achou nada: esta seção vira a resposta inteira da busca. */
  semNadaNoAcervo: boolean;
}) {
  const { user, loading: carregandoConta } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const assentado = useTermoAssentado(termo);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const itens = useSyncExternalStore(importQueue.subscribe, importQueue.list, () => SEM_ITENS);

  const busca = useQuery({
    queryKey: ['mais-musicas', assentado.toLowerCase()],
    queryFn: ({ signal }) => buscarFaixas(assentado, signal),
    enabled: logado && assentado.length >= 2 && assentado === termo,
    // O servidor guarda 10 min; o cliente não precisa perguntar de novo antes.
    // (O link de stream carrega o crachá, que vale ~1 h — 10 min cabe folgado.)
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const faixas = useMemo(() => {
    const vistas = new Set(jaNaTela.map(chaveDaMusica));
    const saida: TrackDto[] = [];
    for (const f of busca.data?.faixas ?? []) {
      const chave = chaveDaMusica(f);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push(f);
    }
    return saida;
  }, [busca.data, jaNaTela]);

  // Adianta a extração das primeiras: é o que faz o play responder em menos de
  // um segundo em vez de 10-17 s (ver `aquecerFontes`).
  useEffect(() => {
    const fontes = faixas
      .slice(0, 2)
      .filter((f) => f.id.startsWith('youtube:'))
      .map((f) => f.sourceUrl ?? '');
    if (fontes.length > 0) void aquecerFontes(fontes);
  }, [faixas]);

  if (!termo) return null;

  const tocar = (indice: number): void => {
    const alvo = faixas[indice];
    if (!alvo) return;
    // A fila leva TODAS — uma fila de uma faixa só pararia no fim da música.
    playQueue(faixas, indice, { source: 'search', sourceId: termo });
    // E por baixo ela vem para o acervo: baixa, vai para o cofre, e a próxima
    // vez toca a cópia. Uma vez só por link.
    const fonte = alvo.sourceUrl;
    if (
      alvo.id.startsWith('youtube:') &&
      fonte &&
      !localLibrary.findBySource(fonte) &&
      !itens.some((i) => i.url === fonte && i.status !== 'error')
    ) {
      importQueue.enqueue(fonte);
    }
  };

  const motivoFalha = busca.data?.motivoFalha ?? null;
  const vazio =
    motivoFalha === 'limite' ? (
      <EmptyState
        icon={SearchX}
        title="Muitas buscas em pouco tempo"
        description="Espere um instante e tente de novo — não é que a música não existe."
      />
    ) : motivoFalha === 'falha' ? (
      <EmptyState
        icon={SearchX}
        title="Busca fora do ar agora"
        description="Não deu para procurar por baixo desta vez. Tente de novo em instantes."
      />
    ) : (
      <EmptyState
        icon={SearchX}
        title={`Nada encontrado para "${termo}"`}
        description="Confira a grafia ou tente o nome do artista junto."
      />
    );

  if (!carregandoConta && !logado) {
    if (!semNadaNoAcervo) return null;
    return (
      <EmptyState
        icon={SearchX}
        title={`Nada no acervo para "${termo}"`}
        description="Entre na sua conta para encontrarmos essa música para você."
        action={
          <Link
            to="/login"
            className="inline-flex h-9 items-center justify-center rounded-full bg-fg px-4 text-sm font-medium text-bg"
          >
            Entrar
          </Link>
        }
      />
    );
  }

  const esperando = assentado !== termo || busca.isLoading || carregandoConta;
  const titulo = semNadaNoAcervo ? 'Músicas' : 'Mais músicas';

  if (esperando) {
    return (
      <section aria-label={titulo} aria-busy className="min-w-0">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">{titulo}</h2>
        <div className="space-y-2">
          {Array.from({ length: semNadaNoAcervo ? 5 : 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (faixas.length === 0) return semNadaNoAcervo ? vazio : null;

  return (
    <section aria-label={titulo} className="min-w-0">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">{titulo}</h2>
      <TrackList>
        {faixas.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            showAlbum={false}
            active={track.id === currentTrack?.id}
            playing={track.id === currentTrack?.id && isPlaying}
            onPlay={() => tocar(index)}
          />
        ))}
      </TrackList>
    </section>
  );
}
