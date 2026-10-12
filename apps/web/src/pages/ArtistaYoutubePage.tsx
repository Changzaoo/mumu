/**
 * A PÁGINA DO ARTISTA QUE SÓ EXISTE NA INTERNET — `/artista-yt/:canal`.
 *
 * O canal do YouTube é a discografia de quem não está em catálogo nenhum. A
 * página lista o que ele subiu (só música: sem live, short, show inteiro) e
 * toca como qualquer artista: a fila é dele, do clique em diante. A faixa
 * tocada vai por baixo para a fila de import, como na busca — da próxima vez
 * ela toca do acervo.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { MicVocal, Play } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/useAuthUser';
import { aquecerFontes, faixaDoYoutube, musicasDoCanal } from '@/lib/local/importerHelper';
import * as importQueue from '@/lib/local/importQueue';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackDto } from '@radinho/shared';

const SEM_ITENS: importQueue.ImportItem[] = [];

async function carregar(canal: string, signal: AbortSignal) {
  const r = await musicasDoCanal(canal, signal);
  if (!r.ok) return { ok: false as const, motivo: r.motivo };
  const faixas = await Promise.all(
    r.resultados.map((m) => localLibrary.findBySource(m.url) ?? faixaDoYoutube(m)),
  );
  return {
    ok: true as const,
    nome: r.nome,
    faixas: faixas.filter((f): f is TrackDto => f !== null),
  };
}

export default function ArtistaYoutubePage() {
  const { canal = '' } = useParams<{ canal: string }>();
  const [params] = useSearchParams();
  const foto = params.get('foto');
  const { user, loading } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const itens = useSyncExternalStore(importQueue.subscribe, importQueue.list, () => SEM_ITENS);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const dados = useQuery({
    queryKey: ['artista-youtube', canal],
    queryFn: ({ signal }) => carregar(canal, signal),
    enabled: logado && canal.length > 0,
    // O link de stream carrega o crachá (~1 h); 10 min cabe folgado.
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const faixas = useMemo(() => (dados.data?.ok ? dados.data.faixas : []), [dados.data]);
  const nome = (dados.data?.ok && dados.data.nome) || 'Artista';

  // Adianta a extração das primeiras — o play responde em menos de um segundo.
  useEffect(() => {
    const fontes = faixas
      .slice(0, 2)
      .filter((f) => f.id.startsWith('youtube:'))
      .map((f) => f.sourceUrl ?? '');
    if (fontes.length > 0) void aquecerFontes(fontes);
  }, [faixas]);

  const tocar = (indice: number): void => {
    const alvo = faixas[indice];
    if (!alvo) return;
    playQueue(faixas, indice, { source: 'artist', sourceId: `youtube:${canal}` });
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

  if (!loading && !logado) {
    return (
      <div className="py-16">
        <EmptyState
          icon={MicVocal}
          title="Entre para ouvir este artista"
          description="As músicas dele vêm direto da internet, e isso precisa da sua conta."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4">
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <span className="size-40 shrink-0 overflow-hidden rounded-full bg-fg/6 shadow-xl">
          {foto ? (
            <img src={foto} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-fg-subtle">
              <MicVocal className="size-12" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            Artista
          </p>
          {dados.isLoading ? (
            <Skeleton className="mt-2 h-10 w-64" />
          ) : (
            <h1 className="mt-1 line-clamp-2 text-4xl font-bold tracking-tight text-fg">{nome}</h1>
          )}
          {faixas.length > 0 && (
            <>
              <p className="mt-2 text-sm text-fg-muted">
                {faixas.length} {faixas.length === 1 ? 'música' : 'músicas'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  onClick={() => tocar(0)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
                >
                  <Play className="size-4 fill-current" /> Tocar
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {dados.isLoading || loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : dados.data && !dados.data.ok ? (
        <EmptyState
          icon={MicVocal}
          title={
            dados.data.motivo === 'limite'
              ? 'Muitas buscas em pouco tempo'
              : 'Não deu para abrir agora'
          }
          description="Tente de novo em instantes."
        />
      ) : faixas.length === 0 ? (
        <EmptyState
          icon={MicVocal}
          title={nome}
          description="Este artista ainda não subiu músicas no canal."
        />
      ) : (
        <TrackList aria-label={`Músicas de ${nome}`}>
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
      )}
    </div>
  );
}
