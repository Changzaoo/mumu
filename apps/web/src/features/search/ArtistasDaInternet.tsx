/**
 * ARTISTAS DA INTERNET — quem não está no acervo também aparece na busca.
 *
 * O artista do bairro que sobe as músicas no próprio canal do YouTube não
 * existia aqui até alguém importar um link dele: a busca só achava artista que
 * já tinha faixa no acervo. Agora o nome digitado também vira busca de CANAIS
 * (`GET /buscar-artistas`), e cada canal é um artista com página própria —
 * as músicas dele, prontas para tocar.
 */
import { useQuery } from '@tanstack/react-query';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { useAuthUser } from '@/hooks/useAuthUser';
import { buscarArtistasNoYoutube } from '@/lib/local/importerHelper';
import { norm } from './filaDoArtista';
import { useTermoAssentado } from './useTermoAssentado';

function inscritosLegivel(n: number | null): string {
  if (n === null) return 'Artista';
  const fmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  return `Artista • ${fmt.format(n)} ${n === 1 ? 'inscrito' : 'inscritos'}`;
}

export function ArtistasDaInternet({
  termo,
  jaNaTela,
}: {
  termo: string;
  /** Nomes dos artistas que a busca já mostra do acervo — não repetem aqui. */
  jaNaTela: readonly string[];
}) {
  const { user } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const assentado = useTermoAssentado(termo);

  const busca = useQuery({
    queryKey: ['artistas-da-internet', assentado.toLowerCase()],
    queryFn: ({ signal }) => buscarArtistasNoYoutube(assentado, signal),
    enabled: logado && assentado.length >= 2 && assentado === termo,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!busca.data?.ok) return null;
  const vistos = new Set(jaNaTela.map(norm));
  const artistas = busca.data.artistas.filter((a) => !vistos.has(norm(a.nome)));
  if (artistas.length === 0) return null;

  return (
    <SectionCarousel title="Artistas">
      {artistas.map((a) => (
        <MediaCard
          key={a.canal}
          title={a.nome}
          subtitle={inscritosLegivel(a.inscritos)}
          shape="round"
          imageUrl={a.foto}
          to={`/artista-yt/${a.canal}${a.foto ? `?foto=${encodeURIComponent(a.foto)}` : ''}`}
        />
      ))}
    </SectionCarousel>
  );
}
