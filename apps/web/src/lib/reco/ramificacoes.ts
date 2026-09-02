/**
 * AS RAMIFICAÇÕES DO GÊNERO QUE A PESSOA MAIS OUVE.
 *
 * O pedido foi direto: se alguém ouve muito Gospel, a Home abre em Gospel — e
 * logo abaixo vêm as RAMIFICAÇÕES de Gospel, não o próximo assunto.
 *
 * ── POR QUE NÃO DÁ PARA RAMIFICAR PELO SUBGÊNERO ──
 *
 * A saída óbvia seria "Gospel → Adoração, Congregacional, Gospel Contemporâneo".
 * Nossa taxonomia (`GENRE_TAXONOMY`, em packages/shared) é PLANA: Gospel é uma
 * folha, não tem filhos. Inventar subgêneros aqui significaria adivinhar o
 * rótulo de cada faixa a partir do título — exatamente o tipo de chute que o
 * classificador de gênero deste app se recusa a dar (ver `generos.ts`: rótulo
 * que não dá para traduzir com segurança vira `null`, nunca um palpite).
 *
 * Então ramifica-se pelos eixos que os dados REALMENTE têm, que é como o
 * Spotify monta os Daily Mixes: não por sub-rótulo, mas por recortes do próprio
 * comportamento dentro daquele gosto. Cada ramo abaixo responde uma pergunta
 * diferente sobre o mesmo gênero:
 *
 *   1. o que você mais ouve dele        (aproveitamento — o terreno seguro)
 *   2. mais de {artista} que você ouve  (o ramo que tem cara de artista)
 *   3. o que você ainda não ouviu dele  (exploração — dentro do gosto)
 *   4. de volta ao que você ouvia       (nostalgia: sumiu do rodízio)
 *   5. os vizinhos de família           (Samba → Pagode, Axé)
 *
 * Isso é a tríade do artigo do Spotify — "Explore, Exploit, Explain": misturar
 * o certeiro com o novo, e DIZER por que cada prateleira está ali. Por isso
 * `explicacao` não é enfeite: é campo obrigatório de cada ramo.
 *
 * ── O RAMO QUE NÃO TEM MATERIAL NÃO APARECE ──
 *
 * Prateleira curta é pior que prateleira ausente: uma fileira com duas faixas
 * anuncia que o app não tem o que mostrar. Todo ramo abaixo exige um mínimo, e
 * some sozinho quando não o alcança.
 *
 * Puro e testável: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { familiaDoGenero } from '@radinho/shared';
import { daySeed, seededShuffle } from './recommend';
import { chaveDeTexto, pesoDoPlay, type PerfilDeGosto, type PlayObservado } from './perfilDeGosto';

export type TipoDeRamo = 'aproveitamento' | 'exploracao';

export interface Ramificacao {
  /** Estável no dia — serve de `key` de React e de `sourceId` da fila. */
  key: string;
  titulo: string;
  /** O "Explain" do Explore-Exploit-Explain: por que ISTO está na tela. */
  explicacao: string;
  tipo: TipoDeRamo;
  tracks: TrackDto[];
}

/** Abaixo disto o ramo não vira prateleira — vira buraco na página. */
const MINIMO_POR_RAMO = 5;
/** Teto de faixas por prateleira: ninguém rola cem cartões na horizontal. */
const POR_RAMO = 14;
/** Teto por artista dentro de um ramo, para a vitrine ter caras diferentes. */
const MAX_POR_ARTISTA = 3;
/** "De volta": sem tocar há pelo menos isto. */
const DIAS_DE_SUMICO = 21;
/** Quantos ramos de artista no máximo — dois já dão variedade sem virar lista. */
const MAX_RAMOS_DE_ARTISTA = 2;

function artistaDe(track: TrackDto): string {
  return chaveDeTexto(track.artists?.[0]?.name ?? '');
}

/**
 * Aplica teto por artista e corta no alvo.
 *
 * Segunda passada sem teto quando o gênero tem poucos artistas: sem ela, um
 * gospel de dois cantores viraria uma prateleira de seis faixas e sumiria pelo
 * mínimo — punindo justamente quem tem uma biblioteca focada.
 */
function comVariedade(ordenadas: readonly TrackDto[], alvo: number): TrackDto[] {
  const usados = new Map<string, number>();
  const escolhidas: TrackDto[] = [];
  const vistos = new Set<string>();
  for (const t of ordenadas) {
    const chave = artistaDe(t);
    const quantos = usados.get(chave) ?? 0;
    if (chave && quantos >= MAX_POR_ARTISTA) continue;
    usados.set(chave, quantos + 1);
    escolhidas.push(t);
    vistos.add(t.id);
    if (escolhidas.length >= alvo) return escolhidas;
  }
  for (const t of ordenadas) {
    if (vistos.has(t.id)) continue;
    escolhidas.push(t);
    if (escolhidas.length >= alvo) break;
  }
  return escolhidas;
}

export interface EntradasDasRamificacoes {
  /** O gênero campeão — o tronco de onde saem os ramos. */
  genero: string;
  /** A biblioteca inteira: os ramos de família precisam olhar fora do gênero. */
  biblioteca: readonly TrackDto[];
  historico: readonly PlayObservado[];
  perfil: PerfilDeGosto;
  /** Gênero de cada faixa quando ela própria não traz. */
  generoDaFaixa?: ReadonlyMap<string, string>;
  now?: Date;
}

export function ramificacoesDoGenero(entradas: EntradasDasRamificacoes): Ramificacao[] {
  const agora = entradas.now ?? new Date();
  const agoraMs = agora.getTime();
  const dia = daySeed(agora);
  const generoDaFaixa = entradas.generoDaFaixa ?? new Map<string, string>();
  const alvoGenero = chaveDeTexto(entradas.genero);

  const generoDe = (t: TrackDto): string | null => t.genre ?? generoDaFaixa.get(t.id) ?? null;
  const doGenero = entradas.biblioteca.filter((t) => {
    const g = generoDe(t);
    return g !== null && chaveDeTexto(g) === alvoGenero;
  });
  if (doGenero.length === 0) return [];

  // Peso e última vez de cada faixa, na MESMA régua do perfil de gosto.
  const peso = new Map<string, number>();
  const ultimoPlay = new Map<string, number>();
  for (const play of entradas.historico) {
    const id = play.track?.id;
    if (!id) continue;
    peso.set(id, (peso.get(id) ?? 0) + pesoDoPlay(play, agoraMs));
    const quando = play.playedAt ? Date.parse(play.playedAt) : Number.NaN;
    if (Number.isFinite(quando)) ultimoPlay.set(id, Math.max(ultimoPlay.get(id) ?? 0, quando));
  }

  const ramos: Ramificacao[] = [];
  const publicar = (ramo: Ramificacao): void => {
    if (ramo.tracks.length >= MINIMO_POR_RAMO) ramos.push(ramo);
  };

  // ── 1. O TERRENO SEGURO: o que ela mais ouve DESTE gênero ────────────────
  const maisOuvidas = doGenero
    .filter((t) => (peso.get(t.id) ?? 0) > 0)
    .sort((a, b) => (peso.get(b.id) ?? 0) - (peso.get(a.id) ?? 0));
  publicar({
    key: `ramo:mais-ouvidas:${entradas.genero}`,
    titulo: `${entradas.genero} que você mais ouve`,
    explicacao: 'O que mais toca por aqui',
    tipo: 'aproveitamento',
    tracks: comVariedade(maisOuvidas, POR_RAMO),
  });

  // ── 2. OS ARTISTAS DENTRO DO GÊNERO ──────────────────────────────────────
  //
  // O ramo com cara de artista é o que a pessoa reconhece primeiro: ela não
  // pensa "gospel de adoração", pensa "aquele do Fernandinho". A ordem vem da
  // afinidade do PERFIL, não da contagem de faixas — ter quarenta faixas de um
  // artista que ela nunca tocou não faz dele um artista dela.
  const porArtista = new Map<string, TrackDto[]>();
  for (const t of doGenero) {
    const chave = artistaDe(t);
    if (!chave) continue;
    const lista = porArtista.get(chave);
    if (lista) lista.push(t);
    else porArtista.set(chave, [t]);
  }
  const artistasOrdenados = [...porArtista.entries()]
    .filter(([, faixas]) => faixas.length >= MINIMO_POR_RAMO)
    .sort(
      (a, b) =>
        (entradas.perfil.porArtista.get(b[0]) ?? 0) - (entradas.perfil.porArtista.get(a[0]) ?? 0),
    )
    .filter(([chave]) => (entradas.perfil.porArtista.get(chave) ?? 0) > 0)
    .slice(0, MAX_RAMOS_DE_ARTISTA);
  for (const [chave, faixas] of artistasOrdenados) {
    const nome = entradas.perfil.nomeDoArtista.get(chave) ?? faixas[0]?.artists?.[0]?.name ?? chave;
    // Embaralho do dia: o ramo do artista tem material fixo, e sem rotação ele
    // seria a mesma vitrine para sempre.
    const ordem = seededShuffle(faixas, dia ^ hash(chave));
    publicar({
      key: `ramo:artista:${chave}`,
      titulo: `Mais de ${nome}`,
      explicacao: `Do seu ${entradas.genero}`,
      tipo: 'aproveitamento',
      tracks: ordem.slice(0, POR_RAMO),
    });
  }

  // ── 3. A EXPLORAÇÃO, DENTRO DO GOSTO ─────────────────────────────────────
  //
  // Nunca tocadas, do gênero que ela mais ouve. É o lugar mais barato de
  // arriscar: erra no máximo a faixa, nunca o gosto.
  const naoTocadas = doGenero.filter((t) => !peso.has(t.id));
  publicar({
    key: `ramo:descobrir:${entradas.genero}`,
    titulo: `${entradas.genero} para descobrir`,
    explicacao: 'Na sua biblioteca, ainda sem play',
    tipo: 'exploracao',
    tracks: comVariedade(seededShuffle(naoTocadas, dia ^ hash(entradas.genero)), POR_RAMO),
  });

  // ── 4. NOSTALGIA: o que ela ouvia e parou ────────────────────────────────
  const corte = agoraMs - DIAS_DE_SUMICO * 86_400_000;
  const sumidas = doGenero
    .filter((t) => {
      const quando = ultimoPlay.get(t.id);
      return quando !== undefined && quando < corte;
    })
    .sort((a, b) => (ultimoPlay.get(a.id) ?? 0) - (ultimoPlay.get(b.id) ?? 0));
  publicar({
    key: `ramo:de-volta:${entradas.genero}`,
    titulo: `De volta ao ${entradas.genero}`,
    explicacao: 'Você ouvia e sumiu do rodízio',
    tipo: 'exploracao',
    tracks: comVariedade(sumidas, POR_RAMO),
  });

  // ── 5. OS VIZINHOS DE FAMÍLIA ────────────────────────────────────────────
  //
  // Samba puxa Pagode e Axé; Trap puxa Rap. É a mesma noção de convivência que
  // já defende o rádio deste app (`podemConviver`), usada aqui para AMPLIAR em
  // vez de barrar. Gospel não tem vizinho na taxonomia — a família `devocional`
  // é só ele — e nesse caso o ramo simplesmente não sai, que é o certo: emendar
  // gospel em qualquer outra coisa é o erro que aquela regra existe para evitar.
  const familia = familiaDoGenero(entradas.genero);
  if (familia) {
    const vizinhas = entradas.biblioteca.filter((t) => {
      const g = generoDe(t);
      if (!g || chaveDeTexto(g) === alvoGenero) return false;
      return familiaDoGenero(g) === familia;
    });
    const nomesVizinhos = [...new Set(vizinhas.map((t) => generoDe(t) ?? '').filter(Boolean))];
    publicar({
      key: `ramo:familia:${familia}`,
      titulo: `Perto do ${entradas.genero}`,
      explicacao: nomesVizinhos.slice(0, 3).join(', '),
      tipo: 'exploracao',
      tracks: comVariedade(seededShuffle(vizinhas, dia ^ hash(familia)), POR_RAMO),
    });
  }

  return ramos;
}

/** FNV-1a: hash estável de string → varia o embaralho por ramo. */
function hash(valor: string): number {
  let h = 2166136261;
  for (let i = 0; i < valor.length; i++) {
    h ^= valor.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
