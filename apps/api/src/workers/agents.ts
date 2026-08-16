/**
 * Os agentes que cuidam da biblioteca — cada um com um trabalho, um modelo à
 * altura dele e uma regra clara de quando NÃO agir.
 *
 * O time e o porquê de cada degrau de modelo está medido em
 * `packages/shared/src/ai/models.ts`. O resumo: veredito é tarefa de modelo
 * pequeno, identidade é tarefa de modelo grande, e o Ultra virou escalação em
 * vez de padrão porque devolvia resposta igual à do Super gastando 4× o tempo.
 *
 * REGRA QUE ATRAVESSA TODOS: na dúvida, não escreve. Metadata errada no lugar
 * de metadata certa é o único estrago que o usuário não consegue desfazer
 * sozinho — ele nem fica sabendo que mudou.
 */
import {
  agruparDuplicatas,
  AI_BUDGET,
  artistGenreMessages,
  batchGenreMessages,
  cosineSimilarity,
  type FaixaComparavel,
  type Genre,
  type GrupoDuplicado,
  genreMessages,
  identityMessages,
  modelFor,
  escalationFor,
  parseBatchGenres,
  parseGenre,
  parseIdentity,
  parseVerify,
  trackEmbeddingText,
  verifyGenreMessages,
  verifyMessages,
  type TrackIdentity,
} from '@aurial/shared';
import { logger } from '../core/logger.js';
import { nvidiaChat, nvidiaEmbed } from '../infra/ai/nvidia.js';

const log = logger.child({ worker: 'curation' });

export interface TrackFacts {
  title: string;
  artists: string[];
  album?: string | null;
  genre?: string | null;
}

// ── Agente 1: AUDITOR — a atribuição está errada? ───────────────────────────

/**
 * Três respostas possíveis, e as três importam: `true` confirma, `false`
 * acusa, `null` é "não sei".
 *
 * Só o `false` autoriza mexer. O `null` é tratado como confirmação de
 * propósito — um "não sei" que reescrevesse metadata seria um palpite com
 * cara de conserto.
 */
export async function auditor(facts: TrackFacts): Promise<boolean | null> {
  if (facts.artists.length === 0) return false; // sem artista: não há o que confirmar
  const resposta = await nvidiaChat(verifyMessages(facts.title, facts.artists.join(', ')), {
    model: modelFor('verify'),
    maxTokens: AI_BUDGET.verify,
  });
  return resposta === null ? null : parseVerify(resposta);
}

// ── Agente 1b: AUDITOR DE GÊNERO — a categoria está errada? ─────────────────

/**
 * Mesma prudência do auditor de atribuição: só o `false` autoriza mexer.
 *
 * Existe porque a curadoria só sabia PREENCHER gênero vazio. Faixa já
 * categorizada nunca mais era olhada — então um trap que caiu na prateleira de
 * sertanejo ficava lá para sempre, e nenhuma quantidade de dias rodando 24/7
 * mudava isso. Preencher buraco não é a mesma coisa que consertar erro.
 */
export async function auditorDeGenero(facts: TrackFacts): Promise<boolean | null> {
  const genero = facts.genre?.trim();
  if (!genero || facts.artists.length === 0) return null; // nada a conferir
  const resposta = await nvidiaChat(
    verifyGenreMessages(facts.title, facts.artists.join(', '), genero),
    { model: modelFor('verify'), maxTokens: AI_BUDGET.verify },
  );
  return resposta === null ? null : parseVerify(resposta);
}

// ── Agente 2: IDENTIFICADOR — quem é, de verdade? ───────────────────────────

/**
 * Roda no `super`; se ele voltar de mãos vazias, escala para o `ultra`.
 *
 * A escalação é para resposta ILEGÍVEL, não para resposta ruim: se o Super
 * respondeu um JSON válido, ele é a resposta. Perguntar de novo a um modelo
 * maior até gostar do que ouve é como se convence de qualquer coisa.
 */
export async function identificador(facts: TrackFacts): Promise<TrackIdentity | null> {
  const messages = identityMessages(facts.title, facts.artists.join(', ') || undefined);

  const primeira = await nvidiaChat(messages, {
    model: modelFor('identity'),
    maxTokens: AI_BUDGET.identity,
  });
  const parsed = primeira ? parseIdentity(primeira) : null;
  if (parsed) return parsed;

  const escalado = escalationFor('identity');
  if (!escalado) return null;

  log.debug({ title: facts.title }, 'identidade ilegível no super — escalando para o ultra');
  const segunda = await nvidiaChat(messages, { model: escalado, maxTokens: AI_BUDGET.identity });
  return segunda ? parseIdentity(segunda) : null;
}

// ── Agente 3: GENERISTA — em lote, porque gênero é tarefa repetitiva ────────

/** Quantas faixas por chamada. Acima disso a correspondência por índice fica frágil. */
const GENRE_BATCH = 20;

/**
 * Classifica várias faixas de uma vez. Devolve um array do MESMO tamanho da
 * entrada, alinhado por índice, com `null` onde não soube.
 *
 * Se o modelo devolver uma lista de tamanho diferente, o alinhamento por
 * índice deixou de valer e o lote inteiro vira `null` — trocar o gênero de uma
 * faixa pelo da outra é pior que não classificar nenhuma. Quem faz esse corte é
 * `parseBatchGenres`.
 */
export async function generista(tracks: TrackFacts[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(tracks.length).fill(null);

  for (let i = 0; i < tracks.length; i += GENRE_BATCH) {
    const fatia = tracks.slice(i, i + GENRE_BATCH);
    const resposta = await nvidiaChat(
      batchGenreMessages(
        fatia.map((t) => ({ title: t.title, artist: t.artists.join(', ') || 'desconhecido' })),
      ),
      // O orçamento cresce com o lote — e cresce pelo RACIOCÍNIO, não pelo
      // rótulo: cada faixa a mais é mais uma decisão a tomar antes de escrever
      // o array. 24 tokens por item cobria só a saída e o teto estourava no
      // meio do pensamento.
      { model: modelFor('genre'), maxTokens: AI_BUDGET.genre + fatia.length * 80 },
    );

    if (!resposta) continue;
    const generos = parseBatchGenres(resposta, fatia.length);

    // O lote falhou inteiro (tamanho divergente). Cai para uma chamada por
    // faixa: mais caro, mas classificar em lote não pode virar motivo de a
    // faixa nunca receber gênero.
    const nenhum = generos.every((g) => g === null);
    if (nenhum && fatia.length > 1) {
      log.debug({ lote: fatia.length }, 'lote de gênero inutilizável — caindo para individual');
      for (let j = 0; j < fatia.length; j += 1) {
        const t = fatia[j]!;
        const uma = await nvidiaChat(genreMessages(t.title, t.artists.join(', ') || undefined), {
          model: modelFor('genre'),
          maxTokens: AI_BUDGET.genre,
        });
        out[i + j] = uma ? parseGenre(uma) : null;
      }
      continue;
    }

    for (let j = 0; j < generos.length; j += 1) out[i + j] = generos[j]!;
  }

  return out;
}

// ── Agente 3b: GÊNERO REAL DO ARTISTA — quem ele é, na vida real ────────────

/**
 * Descobre o gênero PRINCIPAL de um artista — a propriedade dele, não de cada
 * faixa. Existe para o defeito que a coerência interna não alcança: uma
 * discografia espalhada por muitos gêneros SEM maioria (o Alee, trap, medido em
 * dez gêneros no acervo), onde a própria biblioteca virou ruído e não há voto
 * confiável para consertar.
 *
 * Devolve um `Genre` só quando o modelo respondeu um gênero ÚNICO e confiante.
 * ECLÉTICO (o artista transita mesmo por vários) e DESCONHECIDO (não sabe quem é)
 * caem para `null` no parser — e `null` NÃO força nada, que é a defesa contra
 * achatar um artista genuinamente eclético ou chutar um que o modelo não conhece.
 *
 * Roda no `super` (conhecimento de mundo, como a identidade). A amostra de
 * títulos ajuda a desambiguar homônimos antes de o modelo decidir.
 */
export async function generoRealDoArtista(
  artist: string,
  sampleTitles: string[] = [],
): Promise<Genre | null> {
  const nome = artist.trim();
  if (!nome) return null;
  const resposta = await nvidiaChat(artistGenreMessages(nome, sampleTitles), {
    model: modelFor('artistGenre'),
    maxTokens: AI_BUDGET.genre,
  });
  return resposta ? parseGenre(resposta) : null;
}

// ── Agente 4: DNA — o vetor que faz busca semântica e "parecidas" ──────────

/** Lote de vetorização. O modelo aceita bem 32 por chamada e responde em ~240ms. */
const EMBED_BATCH = 32;

/**
 * Vetoriza faixas para busca por significado ("aquela música triste de piano")
 * e para achar parecidas sem depender de gênero.
 *
 * Devolve `null` por faixa que não deu — a entrada fica sem DNA e é tentada na
 * próxima volta, em vez de gravar um vetor pela metade.
 */
export async function dna(tracks: TrackFacts[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(tracks.length).fill(null);

  for (let i = 0; i < tracks.length; i += EMBED_BATCH) {
    const fatia = tracks.slice(i, i + EMBED_BATCH);
    const vetores = await nvidiaEmbed(fatia.map(trackEmbeddingText), { inputType: 'passage' });
    if (!vetores) continue;
    for (let j = 0; j < vetores.length; j += 1) out[i + j] = vetores[j]!;
  }

  return out;
}

// ── Agente 5: FAXINEIRO — a mesma música com dois nomes vira uma ──────────

/**
 * Acha grupos de duplicatas na biblioteca de um usuário.
 *
 * A lógica de decisão vive em `@aurial/shared` (`duplicatas.ts`) e é pura —
 * aqui só entra a colheita dos dados. Isso importa: fundir é destrutivo e
 * acontece sem o usuário ver, então a regra tem que ser testável sem Firestore.
 *
 * O DNA gravado pelo agente 4 entra como sinal: dois vetores quase idênticos
 * são a mesma gravação mesmo quando os títulos não se parecem em nada.
 */
export function faxineiro(faixas: FaixaComparavel[]): GrupoDuplicado[] {
  const grupos = agruparDuplicatas(faixas);
  for (const g of grupos) {
    log.info(
      {
        fica: g.manter.title,
        somem: g.remover.map((r) => r.title),
        motivo: g.motivo,
      },
      'duplicatas encontradas',
    );
  }
  return grupos;
}

/** Reexportado para quem for ranquear "parecidas" a partir do DNA gravado. */
export { cosineSimilarity };
