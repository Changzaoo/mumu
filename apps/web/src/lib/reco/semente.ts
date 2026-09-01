/**
 * A PRATELEIRA DOS ARTISTAS QUE A PESSOA ESCOLHEU AO ENTRAR.
 *
 * Gênero orienta a Home inteira (ver `generosDoGosto`), mas gênero é abstrato:
 * "MPB" não é uma promessa que dá para conferir. Artista é. Quem escolheu cinco
 * nomes na entrada espera ver AQUELES nomes na primeira tela — se não vir, a
 * pergunta que acabou de responder parece decorativa.
 *
 * Por isso esta prateleira é literal: só faixas dos artistas escolhidos, nada
 * de "parecidos". As descobertas já são trabalho das outras prateleiras.
 *
 * VARIEDADE SEM INSTABILIDADE: embaralho diário determinístico (muda a cada
 * dia, igual entre recarregamentos do mesmo dia) e teto por artista, para que
 * cinco escolhas não virem uma prateleira de um artista só — o que aconteceria
 * naturalmente sempre que um deles tivesse muito mais música que os outros.
 *
 * Pura e testável: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { daySeed, seededShuffle } from './recommend';

/** Nomes de artista vêm de metadata de fontes diferentes; comparar sem caixa
 *  nem espaço de sobra evita que "Djavan " não case com "djavan". */
function chaveArtista(nome: string): string {
  return nome.toLowerCase().trim();
}

export function prateleiraDaSemente(
  tracks: readonly TrackDto[],
  artistas: readonly string[],
  opts: { limite?: number; maxPorArtista?: number; now?: Date } = {},
): TrackDto[] {
  const escolhidos = new Set(artistas.map(chaveArtista).filter(Boolean));
  if (escolhidos.size === 0) return [];

  const limite = opts.limite ?? 18;
  // Teto proporcional: com um artista escolhido a prateleira é dele inteira;
  // com cinco, nenhum passa de um quinto (mínimo 2, senão a prateleira fica
  // curta demais quando alguém escolhe muitos nomes de acervo pequeno).
  const maxPorArtista = opts.maxPorArtista ?? Math.max(2, Math.ceil(limite / escolhidos.size));

  const daSemente = tracks.filter((t) =>
    t.artists?.some((a) => escolhidos.has(chaveArtista(a.name ?? ''))),
  );
  if (daSemente.length === 0) return [];

  const embaralhado = seededShuffle(daSemente, daySeed(opts.now ?? new Date()));

  const usados = new Map<string, number>();
  const escolha: TrackDto[] = [];
  const vistos = new Set<string>();
  for (const t of embaralhado) {
    // O teto conta pelo artista ESCOLHIDO da faixa, não pelo primeiro crédito:
    // numa participação, o primeiro crédito pode ser alguém que a pessoa não
    // escolheu, e o teto deixaria de segurar quem ela escolheu.
    const chave =
      t.artists?.map((a) => chaveArtista(a.name ?? '')).find((k) => escolhidos.has(k)) ?? '';
    const c = usados.get(chave) ?? 0;
    if (c >= maxPorArtista) continue;
    usados.set(chave, c + 1);
    escolha.push(t);
    vistos.add(t.id);
    if (escolha.length >= limite) break;
  }
  // Se o teto deixou a prateleira curta (um artista com muita música e os
  // outros com pouca), completa sem duplicar — prateleira curta é pior que
  // prateleira desbalanceada.
  if (escolha.length < limite) {
    for (const t of embaralhado) {
      if (vistos.has(t.id)) continue;
      escolha.push(t);
      vistos.add(t.id);
      if (escolha.length >= limite) break;
    }
  }
  return escolha;
}
