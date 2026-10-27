/**
 * O MUNDO DA MÚSICA no app — agenda, prêmios, lançamentos e transmissões.
 *
 * Tudo vem do NOSSO servidor (`/mundo`), que mantém isso em cache lido de
 * fontes públicas por um worker com orçamento. A página nunca chama
 * MusicBrainz, Wikidata, Bandsintown ou YouTube: ela lê o que o agente trouxe.
 * Leitura aberta (visitante vê a agenda na ficha do artista).
 *
 * FAIXA ETÁRIA. O que aparece a menores segue a regra única de
 * `lib/conteudo/faixaEtaria.ts`: criança e adolescente não recebem o player
 * do YouTube embutido (conteúdo de fora, que não julgamos) — só o local, o
 * horário e o link; e a agenda inteira some quando a pessoa não pode ouvir
 * nenhuma faixa daquele artista no acervo.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';
import * as localLibrary from '@/lib/local/localLibrary';
import { faixaEtariaAtual, podeOuvir } from '@/lib/conteudo/faixaEtaria';

export type TipoDeEvento = 'SHOW' | 'FESTIVAL' | 'TRANSMISSAO' | 'PREMIO' | 'LANCAMENTO';

export interface EventoDoMundo {
  id: string;
  tipo: TipoDeEvento;
  titulo: string;
  descricao: string | null;
  quando: string | null;
  local: string | null;
  cidade: string | null;
  pais: string | null;
  preco: string | null;
  linkIngresso: string | null;
  link: string | null;
  youtubeId: string | null;
  embed: boolean;
  fonte: string;
}

export interface AgendaDoArtista {
  artista: string;
  atualizadoEm: string | null;
  links: Record<string, string>;
  eventos: EventoDoMundo[];
}

export interface AvisoDoMundo extends EventoDoMundo {
  artista: string;
  chave: string;
}

const STALE = 10 * 60_000;

export async function buscarAgenda(nome: string): Promise<AgendaDoArtista | null> {
  try {
    const r = await api.get<AgendaDoArtista>(`/mundo/artista/${encodeURIComponent(nome)}`, {
      anonymous: true,
    });
    return r.data;
  } catch (err) {
    // 404 = artista fora do acervo; qualquer outra falha também é "sem agenda".
    void err;
    return null;
  }
}

export async function buscarAvisos(nomes: string[]): Promise<AvisoDoMundo[]> {
  if (nomes.length === 0) return [];
  const r = await api.get<AvisoDoMundo[]>('/mundo/avisos', {
    anonymous: true,
    query: { artistas: nomes.slice(0, 60).join('|') },
  });
  return r.data;
}

export function useAgendaDoArtista(
  nome: string,
  ligado = true,
): UseQueryResult<AgendaDoArtista | null> {
  return useQuery({
    queryKey: ['mundo', 'agenda', nome],
    enabled: ligado && nome.trim().length > 0,
    staleTime: STALE,
    retry: false,
    queryFn: () => buscarAgenda(nome),
  });
}

export function useAvisosDoMundo(nomes: string[]): UseQueryResult<AvisoDoMundo[]> {
  return useQuery({
    queryKey: ['mundo', 'avisos', nomes],
    enabled: nomes.length > 0,
    staleTime: STALE,
    retry: false,
    queryFn: () => buscarAvisos(nomes),
  });
}

// ── faixa etária ────────────────────────────────────────────────────────────

/** Adulto vê o YouTube embutido; menor vê só local, horário e link. */
export function podeVerEmbed(): boolean {
  return faixaEtariaAtual() === 'adulto';
}

/**
 * A agenda de um artista aparece para esta pessoa? Adulto: sempre. Menor: só
 * se pode ouvir ao menos uma faixa dele no acervo — artista cujo repertório
 * inteiro é vetado não ganha vitrine de show.
 */
export function podeVerAgendaDe(artista: string): boolean {
  if (faixaEtariaAtual() === 'adulto') return true;
  const faixas = localLibrary.artistTracks(artista);
  if (faixas.length === 0) return true; // seguido sem faixa: nada a julgar
  return faixas.some((t) => podeOuvir(t));
}

// ── agrupar para a tela ─────────────────────────────────────────────────────

export interface AgendaAgrupada {
  proximos: EventoDoMundo[];
  transmissoes: EventoDoMundo[];
  premios: EventoDoMundo[];
  lancamentos: EventoDoMundo[];
  passados: EventoDoMundo[];
}

/** Separa a lista do servidor nas seções da tela. Puro. */
export function agruparAgenda(eventos: EventoDoMundo[], agora = new Date()): AgendaAgrupada {
  const ontem = agora.getTime() - 86_400_000;
  const g: AgendaAgrupada = {
    proximos: [],
    transmissoes: [],
    premios: [],
    lancamentos: [],
    passados: [],
  };
  for (const e of eventos) {
    if (e.tipo === 'PREMIO') g.premios.push(e);
    else if (e.tipo === 'LANCAMENTO') g.lancamentos.push(e);
    else if (e.tipo === 'TRANSMISSAO') g.transmissoes.push(e);
    else if (!e.quando || new Date(e.quando).getTime() >= ontem) g.proximos.push(e);
    else g.passados.push(e);
  }
  const asc = (a: EventoDoMundo, b: EventoDoMundo): number =>
    (a.quando ? new Date(a.quando).getTime() : Infinity) -
    (b.quando ? new Date(b.quando).getTime() : Infinity);
  const desc = (a: EventoDoMundo, b: EventoDoMundo): number => -asc(a, b);
  g.proximos.sort(asc);
  g.transmissoes.sort(desc);
  g.premios.sort(desc);
  g.lancamentos.sort(desc);
  g.passados.sort(desc);
  return g;
}

/** "sex., 20 de nov. · 21:00" ou "nov. de 2026" quando só há o dia 1 sem hora. */
export function quandoPorExtenso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const temHora = d.getUTCHours() !== 12 || d.getUTCMinutes() !== 0;
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  if (!temHora) return dia;
  return `${dia} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
