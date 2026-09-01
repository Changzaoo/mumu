/**
 * Agente pesquisador — sai atrás de música dos artistas que o usuário está
 * ouvindo, sem que ele precise procurar.
 *
 * A ideia: se a pessoa tocou "Matuê" oito vezes esta semana e só tem três
 * músicas dele na biblioteca, faltam músicas dele na biblioteca. O agente
 * busca no YouTube, pega os links e ENFILEIRA — nunca baixa por conta própria
 * fora da fila, que é onde vivem a pausa, o teto e a deduplicação.
 *
 * TRÊS FREIOS, porque um agente que baixa sozinho pode gastar a internet e o
 * disco de alguém sem pedir licença:
 *   1. só roda quando o usuário LIGA (é opt-in nas configurações);
 *   2. teto por rodada e por artista;
 *   3. nada é baixado se a faixa já existir — nem por link, nem por título.
 *
 * O trabalho pesado de decidir "isto já está na biblioteca" fica na fila de
 * import, que já sabe reconhecer origem repetida e áudio idêntico.
 */
import type { TrackDto } from '@radinho/shared';
import { aiSearchYouTube } from '@/lib/local/importerHelper';
import * as importQueue from '@/lib/local/importQueue';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localHistory from '@/lib/local/localHistory';
import * as localLikes from '@/lib/local/localLikes';

/** Quantos artistas o agente investiga por rodada. */
const ARTISTAS_POR_RODADA = 2;
/** Quantos resultados ele pede por artista. */
const RESULTADOS_POR_ARTISTA = 8;
/** Quantas faixas ele enfileira por artista, no máximo. */
const NOVAS_POR_ARTISTA = 4;
/**
 * Um artista com menos que isto na biblioteca está "sub-representado" — é onde
 * a busca tem o que acrescentar. Acima disso a pessoa já tem o que quer dele.
 */
const JA_TEM_O_BASTANTE = 8;

export interface ArtistaAlvo {
  nome: string;
  /** Quantas vezes tocou nos últimos dias. */
  plays: number;
  /** Quantas faixas dele já existem na biblioteca. */
  naBiblioteca: number;
}

function norm(nome: string): string {
  return nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Quais artistas merecem uma busca: muito ouvidos e pouco representados.
 *
 * Curtir pesa como três plays porque é o sinal mais deliberado que existe —
 * tocar pode ser a fila andando sozinha, curtir é a pessoa dizendo.
 */
export function escolherArtistas(
  history: readonly { track: TrackDto; playedAt: string }[],
  entries: readonly { track: TrackDto }[],
  liked: readonly TrackDto[],
  agora: Date = new Date(),
): ArtistaAlvo[] {
  const CORTE = agora.getTime() - 30 * 24 * 3600_000;

  const plays = new Map<string, number>();
  const nomeOriginal = new Map<string, string>();
  const anota = (nome: string, peso: number): void => {
    const chave = norm(nome);
    if (!chave) return;
    plays.set(chave, (plays.get(chave) ?? 0) + peso);
    if (!nomeOriginal.has(chave)) nomeOriginal.set(chave, nome);
  };

  for (const h of history) {
    if (new Date(h.playedAt).getTime() < CORTE) continue;
    for (const a of h.track.artists) anota(a.name, 1);
  }
  for (const t of liked) for (const a of t.artists) anota(a.name, 3);

  const naBiblioteca = new Map<string, number>();
  for (const e of entries) {
    for (const a of e.track.artists) {
      const chave = norm(a.name);
      naBiblioteca.set(chave, (naBiblioteca.get(chave) ?? 0) + 1);
    }
  }

  return (
    [...plays.entries()]
      .map(([chave, n]) => ({
        nome: nomeOriginal.get(chave) ?? chave,
        plays: n,
        naBiblioteca: naBiblioteca.get(chave) ?? 0,
      }))
      // Sinal fraco não justifica sair baixando: dois plays podem ter sido a fila.
      .filter((a) => a.plays >= 3 && a.naBiblioteca < JA_TEM_O_BASTANTE)
      // Mais ouvido primeiro; entre dois igualmente ouvidos, o mais carente.
      .sort((a, b) => b.plays - a.plays || a.naBiblioteca - b.naBiblioteca)
      .slice(0, ARTISTAS_POR_RODADA)
  );
}

/** Títulos que já existem na biblioteca, normalizados para comparação. */
function titulosConhecidos(entries: readonly { track: TrackDto }[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const artista = e.track.artists[0]?.name ?? '';
    out.add(`${norm(e.track.title)}|${norm(artista)}`);
  }
  return out;
}

/**
 * Uma rodada do agente. Devolve quantas faixas foram enfileiradas.
 *
 * Nunca lança: pesquisar é um extra, e um extra que quebra a sessão do usuário
 * não é um extra.
 */
export async function pesquisarUmaRodada(agora: Date = new Date()): Promise<number> {
  try {
    const entries = localLibrary.list();
    const alvos = escolherArtistas(localHistory.list(), entries, localLikes.list(), agora);
    if (alvos.length === 0) return 0;

    const conhecidos = titulosConhecidos(entries);
    let enfileiradas = 0;

    for (const alvo of alvos) {
      const achados = await aiSearchYouTube(`${alvo.nome} música`, RESULTADOS_POR_ARTISTA).catch(
        () => null,
      );
      if (!achados) continue;

      let doArtista = 0;
      for (const item of achados) {
        if (doArtista >= NOVAS_POR_ARTISTA) break;
        if (!item.url || !item.title) continue;

        // Já está aqui — por link ou por nome. A fila também confere, mas
        // enfileirar para depois descartar gastaria download à toa.
        if (localLibrary.findBySource(item.url)) continue;
        if (conhecidos.has(`${norm(item.title)}|${norm(alvo.nome)}`)) continue;

        importQueue.enqueue(item.url);
        conhecidos.add(`${norm(item.title)}|${norm(alvo.nome)}`);
        doArtista += 1;
        enfileiradas += 1;
      }
    }

    return enfileiradas;
  } catch {
    return 0;
  }
}

// ── laço de fundo ───────────────────────────────────────────────

/**
 * Espaço entre rodadas. Longo de propósito: o agente existe para engordar a
 * biblioteca com o tempo, não para encher o disco numa tarde.
 */
const INTERVALO_MS = 45 * 60_000;
/** Espera antes da primeira rodada — abrir o app não pode virar download. */
const PRIMEIRA_MS = 3 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Liga o laço, respeitando o interruptor das configurações.
 *
 * Ele confere o interruptor A CADA rodada, e não só ao ligar: desligar nas
 * configurações precisa parar o agente na hora, não na próxima recarga.
 */
export function iniciarPesquisador(estaAtivo: () => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const agendar = (ms: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void volta(), ms);
  };

  const volta = async (): Promise<void> => {
    // Desligado, offline, ou aba escondida: não é hora. Rodar em segundo plano
    // competiria com a música que está tocando pela mesma banda.
    if (estaAtivo() && navigator.onLine && !document.hidden) {
      await pesquisarUmaRodada();
    }
    agendar(INTERVALO_MS);
  };

  agendar(PRIMEIRA_MS);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
