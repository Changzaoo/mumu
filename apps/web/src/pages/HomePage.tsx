/**
 * / — Home, focused on the music people actually ADD to the app: quick-access
 * tiles (Spotify-style, with real artwork), recently played, auto mixes by
 * artist/genre, albums, genres and artists. No external 30s-preview catalog —
 * only real, user-added songs.
 */
import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import type { IconType } from 'react-icons';
import { IoHeart, IoMusicalNotesOutline, IoPeopleOutline, IoTimeOutline } from 'react-icons/io5';
import { Music } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import { MediaCard } from '@/components/media/MediaCard';
import { CartaoDeFaixa } from '@/components/media/CartaoDeFaixa';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import * as localHistory from '@/lib/local/localHistory';
import * as gostoInicial from '@/lib/local/gostoInicial';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import {
  buildAlbumRecommendations,
  buildRecommendations,
  daySeed,
  seededShuffle,
} from '@/lib/reco/recommend';
import { capasDaPrateleira, construirPrateleirasDeAgentes } from '@/lib/reco/agents';
import { generosDoGosto } from '@/lib/reco/generosDoGosto';
import { perfilDeGosto } from '@/lib/reco/perfilDeGosto';
import { ramificacoesDoGenero } from '@/lib/reco/ramificacoes';
import { prateleiraDaSemente } from '@/lib/reco/semente';
import { artistasDoUsuario } from '@/lib/reco/artistasDoUsuario';
import { lyricsCacheEntries } from '@/lib/lyrics/lyrics';
import { ensureVectors, hydrateVectors } from '@/lib/reco/embeddings';
import { buildSemanticMixes } from '@/lib/reco/semanticMixes';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { capaNoTamanho } from '@/lib/capaNoTamanho';

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

interface QuickTile {
  key: string;
  to: string;
  label: string;
  sub: string;
  imageUrl?: string | null;
  gradient?: boolean;
  icon?: IconType;
  round?: boolean;
}

/**
 * Spotify-style quick-access grid: 2×4 tiles with the REAL artwork of the
 * user's own spaces — Curtidas (gradient), latest playlists, top artists.
 */
/** Capa de uma playlist: a da primeira faixa que tem uma. */
function capaDaPlaylist(trackIds: string[]): string | null {
  for (const id of trackIds) {
    const cover = localLibrary.entryFor(id)?.track.coverUrl;
    if (cover) return cover;
  }
  return null;
}

/**
 * A GRADE DE ATALHOS É QUEM ASSINA AS CURTIDAS E AS PLAYLISTS — não a página.
 *
 * Antes `HomePage` assinava `localLikes.count`, e cada curtida re-renderizava a
 * Home inteira: ~1.300 cartões reconciliados por causa de um número de 8
 * pixels (INP de 648 ms no moto g34 emulado, com atraso de entrada de 32 ms —
 * era render, não evento). Com a assinatura aqui, curtir redesenha só estes
 * oito atalhos. `memo`: a página só muda `artists` quando tira foto nova.
 */
const QuickAccess = memo(function QuickAccess({
  artists,
}: {
  artists: localLibrary.LocalArtist[];
}) {
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);
  const likedCount = useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);
  const cover = capaDaPlaylist;
  const tiles: QuickTile[] = [
    {
      key: 'liked',
      to: '/liked',
      label: 'Músicas Curtidas',
      sub: `${likedCount} ${likedCount === 1 ? 'música' : 'músicas'}`,
      gradient: true,
      icon: IoHeart,
    },
  ];
  for (const p of playlists.slice(0, 3)) {
    tiles.push({
      key: `pl:${p.id}`,
      to: `/playlist/${p.id}`,
      label: p.title,
      sub: `Playlist • ${p.trackIds.length} faixas`,
      imageUrl: cover(p.trackIds),
      icon: IoMusicalNotesOutline,
    });
  }
  for (const a of artists.slice(0, 3)) {
    tiles.push({
      key: `ar:${a.name}`,
      to: `/artista/${encodeURIComponent(a.name)}`,
      label: a.name,
      sub: 'Artista',
      imageUrl: a.coverUrl,
      icon: IoPeopleOutline,
      round: true,
    });
  }
  tiles.push({
    key: 'history',
    to: '/history',
    label: 'Tocadas recentemente',
    sub: 'Histórico',
    icon: IoTimeOutline,
  });

  return (
    <div className="grid grid-cols-2 gap-2 px-3 lg:grid-cols-4">
      {tiles.slice(0, 8).map(({ key, to, label, sub, imageUrl, gradient, icon: Icon, round }) => (
        <Link
          key={key}
          to={to}
          className="group flex items-center gap-3 overflow-hidden rounded-md bg-fg/6 pr-3 transition-colors duration-200 hover:bg-fg/12"
        >
          <span
            className={cnTile(gradient)}
            style={round ? { borderRadius: '0 9999px 9999px 0' } : undefined}
          >
            {imageUrl ? (
              <img
                src={capaNoTamanho(imageUrl, 'linha') ?? undefined}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              Icon && <Icon className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-1 text-[13px] font-bold text-fg">{label}</span>
            <span className="line-clamp-1 text-[11px] text-fg-muted">{sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
});

function cnTile(gradient?: boolean): string {
  return [
    'grid size-12 shrink-0 place-items-center overflow-hidden shadow-[2px_0_8px_rgba(0,0,0,0.25)]',
    gradient
      ? 'bg-linear-to-br from-indigo-500 via-violet-500 to-blue-400 text-white'
      : 'bg-fg/10 text-fg-muted',
  ].join(' ');
}

/**
 * Tudo o que a Home mostra, calculado de uma vez.
 *
 * É uma FOTO: tirada quando a biblioteca assenta e mantida enquanto a página
 * estiver montada. Antes cada prateleira recalculava a cada mudança da
 * biblioteca, do histórico ou das curtidas — e tocar uma música grava no
 * histórico. O resultado era a pessoa ir apertar num álbum e ele trocar de
 * lugar debaixo do dedo, e o celular recalculando recomendação sobre milhares
 * de faixas a cada faixa tocada. Sair e voltar tira uma foto nova.
 */
function montarHome(
  entries: localLibrary.LibraryEntry[],
  history: ReturnType<typeof localHistory.listForCurrentUser>,
  semente: ReturnType<typeof gostoInicial.snapshot>,
) {
  const liked = localLikes.list();
  const faixas = entries.map((e) => e.track);
  const genres = localLibrary.genreGroups();
  const artistasDoAcervo = localLibrary.artists();
  const albums = localLibrary.albumGroups();

  // Recently played, deduped by track (latest first).
  const seen = new Set<string>();
  const recentTracks: TrackDto[] = [];
  for (const h of history) {
    if (seen.has(h.track.id)) continue;
    seen.add(h.track.id);
    recentTracks.push(h.track);
    if (recentTracks.length >= 40) break;
  }

  // Artistas DELA para a grade de atalhos — não os maiores do acervo
  // (ver lib/reco/artistasDoUsuario).
  const meusArtistas = artistasDoUsuario(history, liked, semente.artistas, artistasDoAcervo);

  // Prateleiras de gênero ordenadas pelo gosto. O primeiro é o TRONCO: sobe
  // para o topo e as ramificações dele vêm logo abaixo (lib/reco/ramificacoes).
  const generosGosto = generosDoGosto(genres, history, liked, { sementes: semente.generos });
  const [generoTronco, ...outrosGeneros] = generosGosto;

  const generoDaFaixa = new Map<string, string>();
  for (const g of genres) for (const t of g.tracks) generoDaFaixa.set(t.id, g.genre);
  const perfil = perfilDeGosto({
    historico: history,
    curtidas: liked,
    generoDaFaixa,
    sementesDeGenero: semente.generos,
    sementesDeArtista: semente.artistas,
  });
  const ramos = generoTronco
    ? ramificacoesDoGenero({
        genero: generoTronco.genre,
        biblioteca: faixas,
        historico: history,
        perfil,
      })
    : [];

  return {
    insumos: { entries, history },
    vazia: entries.length === 0,
    entriesCount: entries.length,
    artistasDoAcervo,
    albums,
    recentTracks,
    meusArtistas,
    generoTronco,
    outrosGeneros,
    ramos,
    daSemente: prateleiraDaSemente(faixas, semente.artistas),
  };
}

type FotoDaHome = ReturnType<typeof montarHome>;

/**
 * O QUE NÃO É DA PRIMEIRA DOBRA, calculado DEPOIS do primeiro desenho.
 *
 * As recomendações do motor, os álbuns sugeridos, os "momentos" dos agentes e
 * os mixes semânticos ficam abaixo do gênero-tronco, dos ramos e dos recentes:
 * ninguém os vê no primeiro quadro, e juntos eram o grosso dos ~450 ms de
 * `montarHome` no boot do moto g34 emulado. Saem numa folga da thread, com os
 * mesmos insumos da foto (a foto continua UMA só: nada muda debaixo do dedo).
 */
function montarTardia(foto: FotoDaHome) {
  const { entries, history } = foto.insumos;
  const liked = localLikes.list();
  const letras = new Map(lyricsCacheEntries());
  return {
    deFoto: foto,
    recos: buildRecommendations(),
    albumRecos: buildAlbumRecommendations(),
    prateleirasDeAgentes: construirPrateleirasDeAgentes(
      { entries, history, liked, now: new Date() },
      (trackId) => {
        const l = letras.get(trackId);
        return l ? l.lines.map((x) => x.text).join(' ') : null;
      },
    ),
    semanticRecos: buildSemanticMixes({ entries, history, liked }),
  };
}

type PrateleirasTardias = ReturnType<typeof montarTardia>;

/** Cartões montados por prateleira no começo; o resto entra ao rolar. */
const CARTOES_INICIAIS = 15;

function aoOcioso(fn: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 250);
  return () => clearTimeout(id);
}

export default function HomePage() {
  // A página só assina o que decide a FOTO: se a biblioteca assentou e se tem
  // música. Playlists, curtidas e histórico NÃO são dela — a grade de atalhos
  // assina as duas primeiras (ver `QuickAccess`) e o histórico é lido na hora
  // de tirar a foto. Assinar `entries` inteiro, ou o histórico (que cresce a
  // cada faixa tocada), re-renderizava ~1.300 cartões à toa.
  const temMusica = useSyncExternalStore(
    localLibrary.subscribe,
    () => localLibrary.list().length > 0,
    () => false,
  );
  const assentada = useSyncExternalStore(
    localLibrary.subscribe,
    localLibrary.bibliotecaAssentada,
    () => false,
  );

  const playQueue = usePlayerStore((s) => s.playQueue);

  // A foto só é refeita se foi tirada de uma biblioteca VAZIA e agora há
  // música (primeira abertura): trocar vazio por conteúdo não tira nada de
  // debaixo do dedo de ninguém.
  // Estado derivado no próprio render (e não num efeito): voltando para a Home
  // com a biblioteca já assentada, a foto sai no primeiro quadro, sem piscar
  // o esqueleto.
  const [foto, setFoto] = useState<FotoDaHome | null>(null);
  if (assentada && (foto === null || (foto.vazia && temMusica))) {
    setFoto(
      montarHome(localLibrary.list(), localHistory.listForCurrentUser(), gostoInicial.snapshot()),
    );
  }

  // As prateleiras de fora da primeira dobra (ver `montarTardia`).
  const [tardia, setTardia] = useState<PrateleirasTardias | null>(null);
  useEffect(() => {
    if (!foto) return;
    return aoOcioso(() => setTardia(montarTardia(foto)));
  }, [foto]);

  // Vetorização em segundo plano: alimenta a PRÓXIMA foto, não repinta esta.
  useEffect(() => {
    if (!assentada) return;
    let cancelled = false;
    const id = setTimeout(() => {
      void (async () => {
        await hydrateVectors();
        if (cancelled) return;
        const tracks = localLibrary.list().map((e) => e.track);
        if (tracks.length > 0) await ensureVectors(tracks);
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [assentada]);

  if (!foto) return <PageSkeleton variant="home" />;

  const {
    artistasDoAcervo,
    albums,
    recentTracks,
    meusArtistas,
    generoTronco,
    outrosGeneros,
    ramos,
    daSemente,
  } = foto;
  const doTempo = tardia?.deFoto === foto ? tardia : null;
  const recos = doTempo?.recos ?? [];
  const albumRecos = doTempo?.albumRecos ?? [];
  const prateleirasDeAgentes = doTempo?.prateleirasDeAgentes ?? [];
  const semanticRecos = doTempo?.semanticRecos ?? [];

  return (
    <div className="relative space-y-8 py-4">
      {/* Spotify-style tinted header glow fading into the page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-4 h-72 bg-linear-to-b from-accent/14 to-transparent"
      />

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        data-giro="item"
        className="relative px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl"
      >
        {localGreeting()}
      </motion.h1>

      <div className="relative">
        <QuickAccess artists={meusArtistas} />
      </div>

      {/* ── O GÊNERO QUE ELA MAIS OUVE, E OS RAMOS DELE ──────────────────
          Primeiro bloco da página de propósito: é a resposta à pergunta que a
          pessoa tem ao abrir o app ("o que eu ouço?"), e não à que o app tem
          ("o que eu acabei de receber?"). O que vinha aqui antes era
          "Adicionadas recentemente" — a ordem de chegada dos arquivos, que é o
          dado mais fácil de mostrar e o menos interessante de olhar. */}
      {generoTronco && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title={generoTronco.genre}
          subtitle={generoTronco.motivo ?? 'O que mais toca por aqui'}
          href={`/genero/${encodeURIComponent(generoTronco.genre)}`}
        >
          {generoTronco.tracks.map((track, index) => (
            <CartaoDeFaixa
              key={track.id}
              track={track}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              trackId={track.id}
              onPlay={() =>
                playQueue(generoTronco.tracks, index, {
                  source: 'library',
                  sourceId: `genre:${generoTronco.genre}`,
                })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* As ramificações do tronco. Cada uma diz por que está ali — é o
          "Explain" do Explore-Exploit-Explain (ver lib/reco/ramificacoes). */}
      {ramos.map((ramo) => (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          key={ramo.key}
          title={ramo.titulo}
          subtitle={ramo.explicacao}
        >
          {ramo.tracks.map((track, index) => (
            <CartaoDeFaixa
              key={track.id}
              track={track}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              trackId={track.id}
              onPlay={() =>
                playQueue(ramo.tracks, index, { source: 'library', sourceId: ramo.key })
              }
            />
          ))}
        </SectionCarousel>
      ))}

      {/* Recently played on THIS profile. */}
      {recentTracks.length > 0 && (
        <SectionCarousel inicial={CARTOES_INICIAIS} title="Tocadas recentemente" href="/history">
          {recentTracks.map((track, index) => (
            <CartaoDeFaixa
              key={track.id}
              track={track}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              trackId={track.id}
              onPlay={() => playQueue(recentTracks, index, { source: 'home' })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* O que a pessoa escolheu ao entrar (lib/reco/semente). */}
      {daSemente.length > 0 && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title="Dos seus artistas"
          subtitle="Escolhidos por você ao entrar"
        >
          {daSemente.map((track, index) => (
            <CartaoDeFaixa
              key={track.id}
              track={track}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              trackId={track.id}
              onPlay={() => playQueue(daSemente, index, { source: 'library', sourceId: 'semente' })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* Recomendações do motor local — renovam a cada dia, estáveis no dia. */}
      {recos.length > 0 && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title="Feito para você"
          subtitle="Do seu jeito de ouvir"
        >
          {recos.map((rec) => (
            <MediaCard
              key={rec.key}
              title={rec.title}
              subtitle={rec.subtitle}
              imageUrl={rec.coverUrl}
              imageUrls={rec.coverUrls}
              to={rec.key.startsWith('reco:') ? undefined : `/mix/${encodeURIComponent(rec.key)}`}
              onPlay={() =>
                playQueue(seededShuffle(rec.tracks, daySeed()), 0, {
                  source: 'library',
                  sourceId: rec.key,
                })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Time de agentes: cada cartão responde uma pergunta diferente sobre o
          gosto (hora do dia × tipo de dia, rotina da semana, faixa avulsa,
          assunto das letras). Agente sem sinal não aparece. */}
      {prateleirasDeAgentes.length > 0 && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title="Seus momentos"
          subtitle="Cada um pega um lado do seu gosto"
        >
          {prateleirasDeAgentes.map((p) => (
            <MediaCard
              key={p.key}
              title={p.title}
              subtitle={p.subtitle}
              imageUrl={p.tracks[0]?.coverUrl ?? null}
              imageUrls={capasDaPrateleira(p.tracks)}
              onPlay={() => playQueue(p.tracks, 0, { source: 'library', sourceId: p.key })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* Semântica (embeddings): proximidade real entre músicas, não rótulo de
          gênero. Só aparece quando há vetor suficiente — some sozinha se a IA
          não estiver configurada, sem deixar buraco na página. */}
      {semanticRecos.length > 0 && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title="Combina com você"
          subtitle="Pelo som, não pelo rótulo"
        >
          {semanticRecos.map((rec) => (
            <MediaCard
              key={rec.key}
              title={rec.title}
              subtitle={rec.subtitle}
              imageUrl={rec.coverUrl}
              imageUrls={rec.coverUrls}
              onPlay={() => playQueue(rec.tracks, 0, { source: 'library', sourceId: rec.key })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* Seções "adicionadas recentemente"/"no dispositivo" removidas a pedido —
          a Home é recomendação + biblioteca organizada; adicionar músicas vive
          na página própria. */}

      {albumRecos.length > 0 && (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          title="Álbuns para você"
          subtitle="Baseado no que você curte e escuta"
        >
          {albumRecos.map((album) => (
            <MediaCard
              key={`reco-album:${album.key}`}
              title={album.title}
              subtitle={album.artist}
              imageUrl={album.coverUrl}
              to={`/disco/${encodeURIComponent(album.key)}`}
              onPlay={() =>
                playQueue(album.tracks, 0, {
                  source: 'library',
                  sourceId: `reco-album:${album.key}`,
                })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Real albums in the library (capped — o resto vive em "Mostrar tudo"). */}
      {albums.length > 0 && (
        <SectionCarousel inicial={CARTOES_INICIAIS} title="Seus álbuns" href="/library">
          {albums.slice(0, 60).map((album) => (
            <MediaCard
              key={album.key}
              title={album.title}
              subtitle={album.artist}
              imageUrl={album.coverUrl}
              to={`/disco/${encodeURIComponent(album.key)}`}
              onPlay={() =>
                playQueue(album.tracks, 0, { source: 'library', sourceId: `album:${album.key}` })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Os demais gêneros, na ordem do gosto (lib/reco/generosDoGosto). O
          tronco não se repete aqui: ele já abriu a página. */}
      {outrosGeneros.map((g) => (
        <SectionCarousel
          inicial={CARTOES_INICIAIS}
          key={g.genre}
          title={g.genre}
          subtitle={g.motivo}
          href={`/genero/${encodeURIComponent(g.genre)}`}
        >
          {g.tracks.map((track, index) => (
            <CartaoDeFaixa
              key={track.id}
              track={track}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              trackId={track.id}
              onPlay={() =>
                playQueue(g.tracks, index, { source: 'library', sourceId: `genre:${g.genre}` })
              }
            />
          ))}
        </SectionCarousel>
      ))}

      {/* Your artists (capped — a página /artistas tem todos). */}
      {artistasDoAcervo.length > 0 && (
        <SectionCarousel inicial={CARTOES_INICIAIS} title="Seus artistas" href="/artistas">
          {artistasDoAcervo.slice(0, 60).map((artist) => (
            <LocalArtistCard
              key={artist.name}
              name={artist.name}
              trackCount={artist.trackCount}
              fallbackImage={artist.coverUrl}
            />
          ))}
        </SectionCarousel>
      )}

      {foto.vazia && (
        <div className="px-3">
          <EmptyState
            icon={Music}
            title="Sua biblioteca está vazia"
            description="Adicione músicas por link ou importe seus arquivos — elas aparecem aqui, organizadas por gênero e artista."
          />
        </div>
      )}
    </div>
  );
}
