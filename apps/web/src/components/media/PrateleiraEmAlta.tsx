/**
 * "EM ALTA" NA HOME — o que está no topo agora, por gênero, para ESTA pessoa.
 *
 * O retrato vem do servidor (`features/emAlta`); o que aparece é decidido em
 * `lib/emAlta/prateleira`: idade × conteúdo pela regra única, gosto pela
 * tabela de coerência, abas na ordem do que a pessoa mais ouve.
 *
 * Tocar: faixa que já está no acervo toca como qualquer outra. Faixa de fora
 * entra pelo MESMO caminho da busca "mais músicas": começa a tocar pelo
 * `/stream` do importador e vai para a fila de import normal
 * (`lib/local/importQueue`) — nunca por um caminho novo. Sem conta não dá
 * para trazer nada; a pessoa é avisada em vez de ver um botão que não faz nada.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { TrackDto } from '@radinho/shared';
import { CartaoDeFaixa } from '@/components/media/CartaoDeFaixa';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { useEmAlta } from '@/features/emAlta/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { assinar, podeOuvir, registrarVereditos, versaoDoFiltro } from '@/lib/conteudo/faixaEtaria';
import {
  ehDeForaDoAcervo,
  haQuanto,
  montarPrateleira,
  vereditosParaRegistrar,
  type GeneroDaPrateleira,
} from '@/lib/emAlta/prateleira';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import * as gostoInicial from '@/lib/local/gostoInicial';
import {
  buscarNoYoutube,
  faixaDoYoutube,
  videoIdDoYoutube,
  type ResultadoYoutube,
} from '@/lib/local/importerHelper';
import * as importQueue from '@/lib/local/importQueue';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import { familiasDoPerfil } from '@/lib/reco/coerencia';
import { chaveDeTexto, perfilDeGosto } from '@/lib/reco/perfilDeGosto';
import { lerPulos } from '@/lib/reco/pulos';
import { cn, trackArtistNames } from '@/lib/utils';
import { pushNotification } from '@/stores/notificationsStore';
import { usePlayerStore } from '@/stores/playerStore';

const CARTOES_INICIAIS = 10;

/** O resultado da busca que é ESTA música: mesmo nome, duração parecida. */
function escolherVideo(
  resultados: readonly ResultadoYoutube[],
  track: TrackDto,
): ResultadoYoutube | null {
  const titulo = chaveDeTexto(track.title);
  const artista = chaveDeTexto(track.artists[0]?.name ?? '');
  const duracaoSeg = track.durationMs > 0 ? track.durationMs / 1000 : null;
  for (const r of resultados) {
    const texto = chaveDeTexto(`${r.titulo} ${r.canal}`);
    if (!texto.includes(titulo) && !(artista && texto.includes(artista))) continue;
    if (duracaoSeg && Math.abs(r.duracaoSeg - duracaoSeg) > 20) continue;
    return r;
  }
  return null;
}

export function PrateleiraEmAlta() {
  const { data } = useEmAlta();
  const { user } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playTrack = usePlayerStore((s) => s.playTrack);
  // Idade mudou ou veredito chegou: a prateleira é refeita.
  const versao = useSyncExternalStore(assinar, versaoDoFiltro, versaoDoFiltro);

  // O gosto DESTA conta: histórico, curtidas, pulos, seguidos e a escolha do
  // onboarding — a mesma régua da Home (lib/reco/perfilDeGosto).
  const gosto = useMemo(() => {
    const generoDaFaixa = new Map<string, string>();
    const generoDoArtista = new Map<string, string>();
    for (const g of localLibrary.genreGroups()) {
      for (const t of g.tracks) {
        generoDaFaixa.set(t.id, g.genre);
        const a = t.artists?.[0]?.name;
        if (a && !generoDoArtista.has(chaveDeTexto(a))) generoDoArtista.set(chaveDeTexto(a), g.genre);
      }
    }
    const semente = gostoInicial.snapshot();
    const perfil = perfilDeGosto({
      historico: localHistory.listForCurrentUser(),
      curtidas: localLikes.list(),
      generoDaFaixa,
      generoDoArtista,
      sementesDeGenero: semente.generos,
      sementesDeArtista: semente.artistas,
      pulos: lerPulos(),
      seguidos: artistasSeguidos.list().map((a) => a.nome),
    });
    return { familias: familiasDoPerfil(perfil), afinidade: perfil.afinidadeDoGenero };
    // Recalcular quando o retrato chega basta: o gosto muda devagar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const prateleiras = useMemo<GeneroDaPrateleira[]>(() => {
    if (!data) return [];
    registrarVereditos(vereditosParaRegistrar(data));
    return montarPrateleira(data, {
      gosto: gosto.familias,
      afinidade: gosto.afinidade,
      podeOuvir,
      doAcervo: (id) => localLibrary.entryFor(id)?.track ?? null,
    });
    // `versao` entra de propósito: idade ou veredito novo refazem a prateleira.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, gosto, versao]);

  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [trazendo, setTrazendo] = useState<string | null>(null);
  const ativa = prateleiras.find((p) => p.genero === escolhido) ?? prateleiras[0];
  if (!data || !ativa) return null;

  const tocar = async (track: TrackDto, index: number): Promise<void> => {
    const contexto = { source: 'home' as const, sourceId: `em-alta:${ativa.genero}` };
    if (!ehDeForaDoAcervo(track)) {
      const doAcervo = ativa.faixas.filter((t) => !ehDeForaDoAcervo(t));
      playQueue(doAcervo, Math.max(0, doAcervo.indexOf(ativa.faixas[index]!)), contexto);
      return;
    }
    if (!logado) {
      pushNotification({
        type: 'info',
        title: 'Entre na sua conta para ouvir',
        body: 'Esta música ainda não está no acervo; com a conta ela é trazida na hora.',
      });
      return;
    }
    const jaTrazida = track.sourceUrl ? localLibrary.findBySource(track.sourceUrl) : null;
    if (jaTrazida) {
      playTrack(jaTrazida, contexto);
      return;
    }
    setTrazendo(track.id);
    try {
      const artista = track.artists[0]?.name ?? '';
      let video: ResultadoYoutube | null = null;
      if (track.sourceUrl && videoIdDoYoutube(track.sourceUrl)) {
        video = {
          url: track.sourceUrl,
          titulo: `${artista} - ${track.title}`,
          canal: artista,
          duracaoSeg: Math.round(track.durationMs / 1000),
          capa: track.coverUrl,
        };
      } else {
        const busca = await buscarNoYoutube(`${artista} ${track.title}`);
        video = busca.ok ? escolherVideo(busca.resultados, track) : null;
      }
      const faixa = video ? await faixaDoYoutube(video) : null;
      if (!faixa || !video) {
        pushNotification({
          type: 'error',
          title: 'Não achei esta música para tocar',
          body: `${track.title} — ${artista}`,
        });
        return;
      }
      playTrack({ ...faixa, genre: track.genre ?? faixa.genre, coverUrl: track.coverUrl ?? faixa.coverUrl }, contexto);
      // O mesmo caminho de qualquer link colado: a fila de import normal.
      importQueue.enqueue([{ url: video.url, title: `${artista} - ${track.title}` }]);
    } finally {
      setTrazendo(null);
    }
  };

  return (
    <SectionCarousel
      inicial={CARTOES_INICIAIS}
      title="Em alta"
      subtitle={`${ativa.genero === 'Todos' ? 'Em todas as paradas' : `Em ${ativa.genero}`} agora · atualizado ${haQuanto(data.atualizadoEm)}`}
      acessorio={
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist">
          {prateleiras.map((p) => (
            <button
              key={p.genero}
              type="button"
              role="tab"
              aria-selected={p.genero === ativa.genero}
              onClick={() => setEscolhido(p.genero)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                p.genero === ativa.genero
                  ? 'bg-fg text-bg'
                  : 'bg-fg/10 text-fg-muted hover:bg-fg/15 hover:text-fg',
              )}
            >
              {p.genero}
            </button>
          ))}
        </div>
      }
    >
      {ativa.faixas.map((track, index) => (
        <CartaoDeFaixa
          key={track.id}
          track={track}
          title={track.title}
          subtitle={
            trazendo === track.id
              ? 'Trazendo…'
              : ehDeForaDoAcervo(track)
                ? `${trackArtistNames(track)} · #${ativa.origem[index]?.posicao ?? index + 1}`
                : trackArtistNames(track)
          }
          imageUrl={track.coverUrl}
          trackId={track.id}
          onPlay={() => void tocar(track, index)}
        />
      ))}
    </SectionCarousel>
  );
}
