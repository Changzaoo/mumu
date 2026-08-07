/**
 * /s/:id — página PÚBLICA de um compartilhamento.
 *
 * QUEM ABRE O LINK OUVE A MÚSICA INTEIRA, com conta ou sem. O áudio vem da
 * cópia no cofre, cuja URL já foi assinada por quem compartilhou — ver
 * `ShareTrack.remoteUrl`. A prévia de 30s virou último recurso, para o caso de
 * a cópia ter sido descartada pelo teto do cofre.
 *
 * O comentário anterior falava num "gate global do player" que reforçaria o
 * limite de 30s para visitante. Esse gate NÃO EXISTE: `previewOnly` é só um
 * selo na interface, e o player toca o que vier em `streamUrl`. O limite era
 * consequência de `buildStreamUrl` precisar do token de quem ouve — não uma
 * regra deliberada em lugar nenhum.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ListPlus, Music, Play, Share2, UserRoundPlus } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/useAuthUser';
import { searchSongs } from '@/lib/catalog/itunes';
import { buildStreamUrl } from '@/lib/local/importerHelper';
import { enqueue } from '@/lib/local/importQueue';
import { fetchShare, type ShareDoc, type ShareTrack } from '@/lib/share/share';
import { usePlayerStore } from '@/stores/playerStore';

/** ShareTrack → TrackDto tocável (sem fonte ainda — resolvida ao dar play). */
function toDto(t: ShareTrack, index: number, streamUrl: string | null, preview: boolean): TrackDto {
  return {
    id: `share:${index}:${t.title}`,
    title: t.title,
    durationMs: t.durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: t.coverUrl,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [{ id: `share-artist:${index}`, name: t.artist, slug: '', imageUrl: null }],
    streamUrl,
    downloadUrl: null,
    uploadedByUserId: null,
    ...(preview ? { previewOnly: true } : {}),
  } as TrackDto;
}

/**
 * A cópia no cofre ainda está lá?
 *
 * O cofre tem teto e descarta as faixas menos tocadas, então um link
 * compartilhado semanas atrás pode apontar para áudio que já saiu. Pergunta o
 * PRIMEIRO BYTE (`Range: bytes=0-0`): confirma que existe sem baixar nada.
 *
 * Teto de 4s porque isto roda ANTES de a música começar — uma sonda pendurada
 * viraria "cliquei em tocar e não aconteceu nada", que é pior do que cair para
 * a prévia. Sem resposta a tempo conta como ausente.
 */
async function copiaViva(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default function SharedPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [share, setShare] = useState<ShareDoc | null | 'loading'>('loading');
  const { user } = useAuthUser();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    void fetchShare(id).then((doc) => setShare(doc));
  }, [id]);

  const tracks = useMemo(() => (share !== 'loading' && share ? share.tracks : []), [share]);

  /**
   * A fonte de cada faixa, da melhor para a pior — e a primeira delas é o
   * motivo desta função ter mudado.
   *
   *   1. cópia no cofre  → MÚSICA INTEIRA, para qualquer um, sem conta
   *   2. stream ao vivo  → inteira também, mas assina com o token de quem ouve
   *   3. prévia de 30s   → último recurso
   *
   * Antes a lista começava no 2: visitante sem conta caía direto na prévia,
   * porque `buildStreamUrl` assina com o Firebase de QUEM ESTÁ OUVINDO e
   * visitante não tem token. Os 30 segundos não eram uma decisão de produto,
   * eram o único caminho que sobrava.
   *
   * O passo 3 continua existindo por um motivo concreto: o cofre tem teto e
   * descarta as faixas menos tocadas. Um link compartilhado meses atrás pode
   * apontar para áudio que já saiu de lá — e é melhor tocar trinta segundos do
   * que devolver silêncio.
   */
  const play = async (index: number): Promise<void> => {
    const resolved = await Promise.all(
      tracks.map(async (t, i) => {
        // 1. A cópia assinada por quem compartilhou: vale sem login nenhum.
        if (t.remoteUrl && (await copiaViva(t.remoteUrl))) {
          return toDto(t, i, t.remoteUrl, false);
        }
        // 2. Quem tem conta ainda consegue o stream ao vivo da fonte.
        if (user && t.sourceUrl) {
          const url = await buildStreamUrl(t.sourceUrl).catch(() => null);
          if (url) return toDto(t, i, url, false);
        }
        // 3. Sobrou a prévia.
        try {
          const songs = await searchSongs(`${t.title} ${t.artist}`, 'br', 1);
          return toDto(t, i, songs[0]?.previewUrl ?? null, true);
        } catch {
          return toDto(t, i, null, true);
        }
      }),
    );
    const playable = resolved.filter((t) => t.streamUrl);
    if (playable.length === 0) {
      toast.error('Não consegui tocar esta faixa agora. Tente de novo em instantes.');
      return;
    }
    const target = resolved[index]?.streamUrl ? playable.indexOf(resolved[index]!) : 0;
    playQueue(playable, Math.max(0, target), { source: 'home', sourceId: `share:${id}` });
  };

  const addAllToLibrary = (): void => {
    const urls = tracks.map((t) => t.sourceUrl).filter((u): u is string => Boolean(u));
    if (urls.length === 0) return;
    enqueue(urls);
    toast(`${urls.length} música(s) na fila de download`);
  };

  if (share === 'loading') {
    return (
      <div className="space-y-4 py-6" aria-busy>
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!share) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Share2}
          title="Link não encontrado"
          description="Esse compartilhamento não existe mais ou o link está incompleto."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-44 shrink-0 overflow-hidden rounded-xl bg-fg/6 shadow-2xl sm:size-52">
          {share.coverUrl ? (
            <img src={share.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-fg-subtle">
              <Music className="size-10" />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            {share.type} compartilhad{share.type === 'música' ? 'a' : 'o'}
            {share.byName ? ` por ${share.byName}` : ''}
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-fg">{share.title}</h1>
          <p className="text-sm text-fg-muted">{share.subtitle}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void play(0)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
            >
              <Play className="size-4 fill-current" /> Tocar
            </button>
            {user ? (
              <button
                type="button"
                onClick={addAllToLibrary}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold text-fg transition-colors hover:bg-fg/5"
              >
                <ListPlus className="size-4" /> Adicionar à biblioteca
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold text-fg transition-colors hover:bg-fg/5"
              >
                <UserRoundPlus className="size-4" /> Criar conta grátis
              </Link>
            )}
          </div>
          {!user && (
            <p className="text-[13px] text-fg-muted">
              Sem conta você ouve prévias de 30 segundos — registre-se para ouvir tudo completo.
            </p>
          )}
        </div>
      </header>

      <TrackList header showAlbumColumn={false} aria-label={share.title}>
        {tracks.map((t, index) => {
          const dto = toDto(t, index, null, !user);
          return (
            <TrackRow
              key={dto.id}
              track={dto}
              index={index}
              showAlbum={false}
              active={currentTrack?.id === dto.id}
              playing={currentTrack?.id === dto.id && isPlaying}
              onPlay={() => void play(index)}
            />
          );
        })}
      </TrackList>
    </div>
  );
}
