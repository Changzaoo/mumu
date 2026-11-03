/**
 * PLANO B DA LETRA, COM O MOTIVO DO "NÃO".
 *
 * `fetchOutraFonteDeLetra` (importerHelper) devolve `null` tanto para "nenhuma
 * fonte tinha" (404) quanto para "o importador não respondeu" (429 de taxa,
 * 5xx, rede caída). Para quem grava o cache são coisas opostas: a primeira é
 * "sem letra" por uma semana, a segunda é "pergunte de novo na próxima vez".
 * Tratadas igual, um 429 trancava a faixa sem letra por sete dias.
 */
import { helperUrl, type OutraFonteDeLetra } from '@/lib/local/importerHelper';
import { circuitoAberto } from '@/lib/local/saudeDoImportador';

export interface RespostaDaOutraFonte {
  achado: OutraFonteDeLetra | null;
  /** O pedido NÃO teve resposta de verdade (rede, 429, 5xx, importador fora). */
  falhou: boolean;
}

export async function buscarOutraFonte(
  titulo: string,
  artista: string | undefined,
  duracaoSeg: number,
): Promise<RespostaDaOutraFonte> {
  if (circuitoAberto()) return { achado: null, falhou: true };
  try {
    const params = new URLSearchParams({ titulo });
    if (artista) params.set('artista', artista);
    if (duracaoSeg > 0) params.set('duracaoSeg', String(duracaoSeg));
    const res = await fetch(`${helperUrl()}/letra/outras-fontes?${params.toString()}`);
    if (res.status === 404) return { achado: null, falhou: false };
    if (!res.ok) return { achado: null, falhou: true };
    const data = (await res.json().catch(() => null)) as Partial<OutraFonteDeLetra> | null;
    if (!data) return { achado: null, falhou: true };
    const fonte = data.fonte === 'lyrics.ovh' ? 'lyrics.ovh' : 'netease';
    if (data.synced === true && typeof data.lrc === 'string' && data.lrc.trim()) {
      return { achado: { synced: true, lrc: data.lrc, fonte }, falhou: false };
    }
    if (data.synced === false && typeof data.plain === 'string' && data.plain.trim()) {
      return { achado: { synced: false, plain: data.plain, fonte }, falhou: false };
    }
    return { achado: null, falhou: false };
  } catch {
    return { achado: null, falhou: true };
  }
}
