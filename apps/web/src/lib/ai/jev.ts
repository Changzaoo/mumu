/**
 * O JEV NOSSO, do lado do app — decisões tipadas com probabilidade, sem LLM.
 *
 * O importador roda um motor de decisão local (apps/importer/jev): recebe um
 * ESTADO e PERGUNTAS tipadas (choice/score/noul) e devolve, em ~50 ms e de
 * graça, a probabilidade de cada opção e a confiança. Ele aprende com os
 * rótulos curados (memória de ~10 mil faixas com gênero) e com cada rótulo
 * que o app confirma depois (`jevAprender`).
 *
 * Aqui ficam as perguntas que o app faz, no formato que o motor entende. A
 * regra de uso é a mesma do Jev de verdade: ACEITA quando a confiança passa do
 * corte medido na calibração (jev/calibrar.mjs); abaixo disso, a decisão vai
 * para o juiz caro (o LLM da NVIDIA), e o resultado dele volta como exemplo
 * para o motor acertar da próxima vez.
 */
import { GENRE_TAXONOMY, type Genre } from '@radinho/shared';
import { jevAprender, jevDecidir } from '@/lib/local/importerHelper';

/**
 * CORTE DE CONFIANÇA para aceitar o gênero sem o LLM.
 *
 * Confiança = probabilidade do melhor gênero menos a do segundo. Medido em
 * 20/10/2026 por leave-one-out sobre 6.105 faixas com gênero curado (ver
 * apps/importer/jev/motor.mjs): com confiança ≥ 0,2 o motor acerta 96% —
 * e isso cobre metade das faixas, que deixam de gastar o LLM; abaixo de 0,2
 * acerta 65%, então pergunta ao LLM (e a resposta dele vira exemplo).
 */
export const CONFIANCA_PARA_ACEITAR = 0.2;

/** A frase-estado de uma faixa — a MESMA que a memória foi semeada com. */
export function estadoDaFaixa(title: string, artist?: string | null): string {
  const t = title.trim();
  const a = (artist ?? '').trim();
  return a ? `${t} — ${a}` : t;
}

/**
 * Descrições curtas dos gêneros — o motor compara o estado com cada uma
 * (zero-shot) quando a memória não tem vizinhos. Pares confundíveis ganham a
 * mesma ressalva do glossário dos LLMs (curation.ts).
 */
const DESCRICAO: Partial<Record<Genre, string>> = {
  Funk: 'funk carioca, baile funk, MC, DJ, batida de tamborzão (não é o funk americano)',
  'R&B/Soul': 'R&B, soul e o funk americano',
  'Hip-Hop/Rap': 'rap, hip-hop, boom bap, rima',
  Trap: 'trap brasileiro e americano, 808, autotune',
  Sertanejo: 'sertanejo universitário, modão, dupla sertaneja',
  MPB: 'música popular brasileira, bossa nova, cantores e compositores',
  Pagode: 'pagode, samba de roda moderno, grupo de pagode',
  Samba: 'samba tradicional, escola de samba, partido alto',
  Axé: 'axé, música baiana, carnaval de Salvador',
  Forró: 'forró, pé de serra, xote, baião',
  Gospel: 'gospel, louvor, música cristã, adoração',
  Rock: 'rock, guitarra, banda de rock nacional ou internacional',
  Metal: 'heavy metal, thrash, death, metalcore',
  Indie: 'indie rock, indie pop, alternativo',
  Pop: 'pop internacional ou nacional, hit de rádio',
  Dance: 'dance, EDM comercial, house de festa',
  Eletrônica: 'eletrônica, techno, house, drum and bass, ambient',
  Reggae: 'reggae, dub, roots',
  Reggaeton: 'reggaeton, dembow, urbano latino',
  Latina: 'latina, bachata, salsa, cumbia, pop latino',
  Country: 'country americano',
  Jazz: 'jazz, instrumental, big band',
  Blues: 'blues',
  Clássica: 'música clássica, orquestra, erudita',
  'Lo-Fi': 'lo-fi, chill beats, lofi hip hop',
  'K-Pop': 'k-pop, grupo coreano, idol',
};

export interface DecisaoDeGenero {
  genre: Genre;
  confidence: number;
  probabilities: Record<string, number>;
  /** Quanta memória sustentou a resposta (0 = só zero-shot). */
  evidence: number;
}

/** Pergunta o gênero ao motor. Null quando o importador/motor não responde. */
export async function decidirGenero(
  title: string,
  artist?: string | null,
): Promise<DecisaoDeGenero | null> {
  const criteria: Record<string, string> = {};
  for (const g of GENRE_TAXONOMY) criteria[g] = DESCRICAO[g] ?? g;
  const r = await jevDecidir(estadoDaFaixa(title, artist), {
    genero: { type: 'choice', instructions: 'gênero musical da faixa', criteria },
  });
  const a = r?.answers.genero;
  if (!a || a.type !== 'choice' || !GENRE_TAXONOMY.includes(a.choice as Genre)) return null;
  return {
    genre: a.choice as Genre,
    confidence: a.confidence,
    probabilities: a.probabilities,
    evidence: a.evidence ?? 0,
  };
}

/** Um gênero confirmado (pelo LLM, pelo voto do artista ou pela curadoria) vira exemplo. */
export function aprenderGenero(
  title: string,
  artist: string | null | undefined,
  genre: string,
): void {
  void jevAprender('genero', estadoDaFaixa(title, artist), genre).catch(() => undefined);
}
