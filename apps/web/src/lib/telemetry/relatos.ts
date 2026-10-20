/**
 * RELATOS DO OUVINTE — o que deu errado, dito por quem estava ouvindo.
 *
 * O diário de bordo registra o que o app VIU; o relato registra o que a
 * pessoa SENTIU ("demorou", "a letra estava atrasada") no momento em que
 * sentiu, com a faixa e a posição. É o botão "Reportar problema" do player
 * expandido (pedido do dono, 20/10/2026). Cada relato leva junto as últimas
 * linhas do diário, que é o que permite achar a causa depois.
 *
 * Fica no aparelho (teto de 50) e vai para o painel de telemetria no próximo
 * envio — que é disparado na hora do relato, não no flush de saída.
 */
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';
import { anotar, coletarDiario, type Linha } from '@/lib/telemetry/diario';

export const TIPOS_DE_RELATO = [
  { id: 'som-nao-tocou', rotulo: 'O som não tocou' },
  { id: 'som-demorou', rotulo: 'Demorou muito para o som tocar' },
  { id: 'letra-fora-de-sincronia', rotulo: 'A letra estava fora de sincronia' },
  { id: 'letra-errada', rotulo: 'A letra é de outra música' },
  { id: 'video-demorou', rotulo: 'O vídeo demorou para carregar' },
  { id: 'video-nao-carregou', rotulo: 'O vídeo não carregou' },
  { id: 'travou', rotulo: 'O app travou ou engasgou' },
  { id: 'outro', rotulo: 'Outra coisa' },
] as const;

export type TipoDeRelato = (typeof TIPOS_DE_RELATO)[number]['id'];

export interface Relato {
  id: string;
  tipo: TipoDeRelato;
  em: string;
  trackId: string | null;
  titulo: string | null;
  artista: string | null;
  /** Posição da reprodução no momento (segundos). */
  posicaoSeg: number | null;
  detalhe: string | null;
  rota: string | null;
  /** As últimas linhas do diário: o contexto do que o app estava fazendo. */
  diario: Linha[];
}

const CHAVE = 'aurial:relatos';
const TETO = 50;
const LINHAS_DO_DIARIO = 15;

let memoria: Relato[] | null = null;

function ler(): Relato[] {
  if (memoria) return memoria;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    memoria = Array.isArray(lista) ? (lista as Relato[]) : [];
  } catch {
    memoria = [];
  }
  return memoria;
}

registrarDescartavel(CHAVE, 60, () => {
  memoria = null;
});

/** Todos os relatos deste aparelho, do mais novo para o mais antigo. */
export function lerRelatos(): Relato[] {
  return [...ler()];
}

/** Os que vão no envio de telemetria (os 10 mais recentes bastam: o documento
 *  do aparelho tem teto de 64 KB no servidor). */
export function relatosParaEnviar(): Relato[] {
  return ler().slice(0, 10);
}

export function registrarRelato(entrada: {
  tipo: TipoDeRelato;
  trackId?: string | null;
  titulo?: string | null;
  artista?: string | null;
  posicaoSeg?: number | null;
  detalhe?: string | null;
}): Relato {
  const relato: Relato = {
    id: crypto.randomUUID(),
    tipo: entrada.tipo,
    em: new Date().toISOString(),
    trackId: entrada.trackId ?? null,
    titulo: entrada.titulo ?? null,
    artista: entrada.artista ?? null,
    posicaoSeg: typeof entrada.posicaoSeg === 'number' ? Math.round(entrada.posicaoSeg) : null,
    detalhe: entrada.detalhe?.trim().slice(0, 500) || null,
    rota: typeof location !== 'undefined' ? location.pathname : null,
    diario: coletarDiario().linhas.slice(-LINHAS_DO_DIARIO),
  };
  const lista = [relato, ...ler()].slice(0, TETO);
  memoria = lista;
  gravarCache(CHAVE, JSON.stringify(lista), 200_000);
  // Também vira linha do diário: quem lê a sequência vê o relato no lugar certo.
  anotar('player', 'relato', { tipo: relato.tipo, faixa: relato.titulo, seg: relato.posicaoSeg });
  return relato;
}
